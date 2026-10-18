import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";
import { NotFoundError, ValidationError } from "./errors.js";
import { JsonDocumentStore, type StoreFileSystem } from "./store.js";
import { isObject, rejectUnknownFields, requireObject } from "./validation.js";

/** The only reply until a model is connected. Stored like any other message. */
export const placeholderReply = "Chat is not connected to a model yet.";
export const mainThreadId = "main";
export const maxThreadNameLength = 40;
export const maxMessageLength = 2_000;

/** Thread ids are "main" or a UUID; anything else is treated as unknown before touching the file system. */
const threadIdPattern = /^(main|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
}

export interface ChatThreadDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ChatThreadSummary {
  id: string;
  name: string;
  main: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

function validateThread(value: unknown): ChatThreadDocument {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error("chat thread must be an object with schemaVersion 1");
  if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || !Array.isArray(value.messages)) {
    throw new Error("chat thread is missing id, name, timestamps or messages");
  }
  const messages = value.messages.map((raw, index) => {
    if (!isObject(raw) || typeof raw.id !== "string" || (raw.role !== "user" && raw.role !== "assistant") || typeof raw.text !== "string" || typeof raw.createdAt !== "string") {
      throw new Error(`messages[${index}] is malformed`);
    }
    return { id: raw.id, role: raw.role, text: raw.text, createdAt: raw.createdAt } satisfies ChatMessage;
  });
  return { schemaVersion: 1, id: value.id, name: value.name, createdAt: value.createdAt, updatedAt: value.updatedAt, messages };
}

function threadName(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("name must be a string");
  const name = value.trim();
  if (name.length < 1 || name.length > maxThreadNameLength) throw new ValidationError(`name must be 1 to ${maxThreadNameLength} characters`);
  return name;
}

function messageText(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("text must be a string");
  const text = value.trim();
  if (text.length < 1) throw new ValidationError("text must not be empty");
  if (text.length > maxMessageLength) throw new ValidationError(`text must be at most ${maxMessageLength} characters`);
  return text;
}

function summary(thread: ChatThreadDocument): ChatThreadSummary {
  return { id: thread.id, name: thread.name, main: thread.id === mainThreadId, createdAt: thread.createdAt, updatedAt: thread.updatedAt, messageCount: thread.messages.length };
}

export interface ChatServiceOptions {
  clock?: () => Date;
  fs?: StoreFileSystem;
}

/**
 * Text chat threads, one JSON file per thread in `.viral/dashboard/chat/`. UI and storage only: every reply is
 * the fixed placeholder text. Nothing is deleted automatically; a thread lives until the owner deletes it.
 */
export class ChatService {
  private readonly stores = new Map<string, JsonDocumentStore<ChatThreadDocument>>();
  private readonly clock: () => Date;
  private readonly fs: StoreFileSystem;

  constructor(readonly directory: string, options: ChatServiceOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.fs = options.fs ?? nodeFs;
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private store(id: string): JsonDocumentStore<ChatThreadDocument> {
    let store = this.stores.get(id);
    if (!store) {
      const timestamp = this.now();
      // Only Main is created when its file is missing; any other missing thread file means the thread is gone.
      store = new JsonDocumentStore(join(this.directory, `${id}.json`), validateThread, (): ChatThreadDocument => {
        if (id !== mainThreadId) throw new NotFoundError("chat thread", id);
        return { schemaVersion: 1, id: mainThreadId, name: "Main", createdAt: timestamp, updatedAt: timestamp, messages: [] };
      }, this.fs);
      this.stores.set(id, store);
    }
    return store;
  }

  private async fileExists(id: string): Promise<boolean> {
    try { await nodeFs.access(join(this.directory, `${id}.json`)); return true; }
    catch { return false; }
  }

  /** The store for an existing thread; Main always exists (created on first use). Unknown ids raise NotFoundError. */
  private async existing(id: string): Promise<JsonDocumentStore<ChatThreadDocument>> {
    if (!threadIdPattern.test(id)) throw new NotFoundError("chat thread", id);
    if (id === mainThreadId) {
      const main = this.store(mainThreadId);
      if (!(await this.fileExists(mainThreadId))) await main.update(() => undefined);
      return main;
    }
    if (!this.stores.has(id) && !(await this.fileExists(id))) throw new NotFoundError("chat thread", id);
    if (this.stores.has(id) && !(await this.fileExists(id))) {
      this.stores.delete(id);
      throw new NotFoundError("chat thread", id);
    }
    return this.store(id);
  }

  /** Main first, then the other threads oldest first. */
  async listThreads(): Promise<ChatThreadSummary[]> {
    await this.existing(mainThreadId);
    const files = (await nodeFs.readdir(this.directory)).filter((file) => file.endsWith(".json") && threadIdPattern.test(file.slice(0, -5)));
    const threads = await Promise.all(files.map(async (file) => summary(await this.store(file.slice(0, -5)).read())));
    return threads.sort((left, right) => Number(right.main) - Number(left.main) || left.createdAt.localeCompare(right.createdAt) || left.name.localeCompare(right.name));
  }

  async createThread(body: unknown): Promise<ChatThreadSummary> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["name"]);
    const name = threadName(input.name);
    const id = randomUUID();
    const timestamp = this.now();
    const store = new JsonDocumentStore(join(this.directory, `${id}.json`), validateThread,
      (): ChatThreadDocument => ({ schemaVersion: 1, id, name, createdAt: timestamp, updatedAt: timestamp, messages: [] }), this.fs);
    this.stores.set(id, store);
    try { await store.update(() => undefined); }
    catch (error) {
      this.stores.delete(id);
      throw error;
    }
    return summary(await store.read());
  }

  async renameThread(id: string, body: unknown): Promise<ChatThreadSummary> {
    const store = await this.existing(id);
    if (id === mainThreadId) throw new ValidationError("The Main thread cannot be renamed");
    const input = requireObject(body);
    rejectUnknownFields(input, ["name"]);
    const name = threadName(input.name);
    return store.update((thread) => {
      thread.name = name;
      thread.updatedAt = this.now();
      return summary(thread);
    });
  }

  async deleteThread(id: string): Promise<void> {
    const store = await this.existing(id);
    if (id === mainThreadId) throw new ValidationError("The Main thread cannot be deleted");
    await store.remove();
    this.stores.delete(id);
  }

  async listMessages(id: string): Promise<ChatMessage[]> {
    return (await (await this.existing(id)).read()).messages;
  }

  /** Stores the owner's message and the placeholder reply together, in that order, in one atomic write. */
  async postMessage(id: string, body: unknown): Promise<{ message: ChatMessage; reply: ChatMessage }> {
    const store = await this.existing(id);
    const input = requireObject(body);
    rejectUnknownFields(input, ["text"]);
    const text = messageText(input.text);
    return store.update((thread) => {
      const timestamp = this.now();
      const message: ChatMessage = { id: randomUUID(), role: "user", text, createdAt: timestamp };
      const reply: ChatMessage = { id: randomUUID(), role: "assistant", text: placeholderReply, createdAt: timestamp };
      thread.messages.push(message, reply);
      thread.updatedAt = timestamp;
      return { message, reply };
    });
  }
}
