import { randomBytes, randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";
import { actionNames, type ActionName } from "./commands/actions.js";
import { balanceReply, executeAction, undoAction, type ExecutionResult, type FinanceCommandPort, type UndoPlan } from "./commands/execute.js";
import { PlaceholderProposer, placeholderReply, type Proposer } from "./commands/proposer.js";
import { validateProposal, type ResolvedAction } from "./commands/validate.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { localIsoDate } from "./shared/dates.js";
import { JsonDocumentStore, type StoreFileSystem } from "./store.js";
import { isObject, rejectUnknownFields, requireObject } from "./validation.js";

export { placeholderReply } from "./commands/proposer.js";
export const mainThreadId = "main";
export const maxThreadNameLength = 40;
export const maxMessageLength = 2_000;
/** Pending proposals can be confirmed for 10 minutes. */
export const proposalLifetimeMs = 10 * 60_000;
/** A confirmed chat write can be undone for 10 seconds. */
export const undoWindowMs = 10_000;

/** Thread ids are "main" or a UUID; anything else is treated as unknown before touching the file system. */
const threadIdPattern = /^(main|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const proposalIdPattern = /^[0-9a-f]{8}$/;
const undoTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ChatRole = "user" | "assistant";
/** text: plain reply · proposal: a pending action awaiting confirm · invalid: validation errors · result: outcome of confirm/cancel/undo. */
export type ChatMessageKind = "text" | "proposal" | "invalid" | "result";
export type ProposalStatus = "pending" | "confirmed" | "cancelled" | "undone" | "expired";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  kind: ChatMessageKind;
  proposalId?: string;
  errors?: string[];
}

export interface StoredProposal {
  id: string;
  action: ResolvedAction;
  preview: string;
  flags: string[];
  createdAt: string;
  expiresAt: string;
  /** Stored status; "expired" is derived from expiresAt when reading. */
  status: Exclude<ProposalStatus, "expired">;
  resolvedAt: string | null;
}

export interface ProposalView {
  id: string;
  threadId: string;
  action: ActionName;
  preview: string;
  flags: string[];
  createdAt: string;
  expiresAt: string;
  status: ProposalStatus;
}

export interface ChatThreadDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  proposals: StoredProposal[];
  /** Transactions created from this thread, oldest first; the last one is what target "last" means. */
  chatTransactions: { transactionId: string; createdAt: string }[];
}

export interface ChatThreadSummary {
  id: string;
  name: string;
  main: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export type ChatMessageView = ChatMessage & { proposal?: ProposalView };

export interface PostResult {
  outcome: "reply" | "proposal" | "invalid";
  message: ChatMessage;
  reply: ChatMessage;
  proposal?: ProposalView;
  errors?: string[];
}

export interface ConfirmResult {
  proposal: ProposalView;
  entry: ExecutionResult["entry"];
  undo: { token: string; expiresAt: string };
}

const messageKinds: readonly ChatMessageKind[] = ["text", "proposal", "invalid", "result"];
const storedStatuses = ["pending", "confirmed", "cancelled", "undone"] as const;

function validateThread(value: unknown): ChatThreadDocument {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error("chat thread must be an object with schemaVersion 1");
  if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || !Array.isArray(value.messages)) {
    throw new Error("chat thread is missing id, name, timestamps or messages");
  }
  const messages = value.messages.map((raw, index): ChatMessage => {
    if (!isObject(raw) || typeof raw.id !== "string" || (raw.role !== "user" && raw.role !== "assistant") || typeof raw.text !== "string" || typeof raw.createdAt !== "string") {
      throw new Error(`messages[${index}] is malformed`);
    }
    const kind = raw.kind === undefined ? "text" : raw.kind;
    if (!messageKinds.includes(kind as ChatMessageKind)) throw new Error(`messages[${index}].kind is malformed`);
    const message: ChatMessage = { id: raw.id, role: raw.role, text: raw.text, createdAt: raw.createdAt, kind: kind as ChatMessageKind };
    if (typeof raw.proposalId === "string") message.proposalId = raw.proposalId;
    if (Array.isArray(raw.errors)) message.errors = raw.errors.map(String);
    return message;
  });
  // Threads written before the command layer have no proposals or chat transactions yet.
  const proposals = (Array.isArray(value.proposals) ? value.proposals : []).map((raw, index): StoredProposal => {
    if (!isObject(raw) || typeof raw.id !== "string" || !isObject(raw.action) || typeof raw.preview !== "string" || typeof raw.createdAt !== "string"
      || typeof raw.expiresAt !== "string" || !storedStatuses.includes(raw.status as typeof storedStatuses[number]) || !Array.isArray(raw.flags)) {
      throw new Error(`proposals[${index}] is malformed`);
    }
    if (!(actionNames as readonly string[]).includes(String(raw.action.action))) throw new Error(`proposals[${index}].action is unknown`);
    return {
      id: raw.id, action: raw.action as unknown as ResolvedAction, preview: raw.preview, flags: raw.flags.map(String), createdAt: raw.createdAt, expiresAt: raw.expiresAt,
      status: raw.status as StoredProposal["status"], resolvedAt: typeof raw.resolvedAt === "string" ? raw.resolvedAt : null
    };
  });
  const chatTransactions = (Array.isArray(value.chatTransactions) ? value.chatTransactions : []).map((raw, index) => {
    if (!isObject(raw) || typeof raw.transactionId !== "string" || typeof raw.createdAt !== "string") throw new Error(`chatTransactions[${index}] is malformed`);
    return { transactionId: raw.transactionId, createdAt: raw.createdAt };
  });
  return { schemaVersion: 1, id: value.id, name: value.name, createdAt: value.createdAt, updatedAt: value.updatedAt, messages, proposals, chatTransactions };
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

function emptyThread(id: string, name: string, timestamp: string): ChatThreadDocument {
  return { schemaVersion: 1, id, name, createdAt: timestamp, updatedAt: timestamp, messages: [], proposals: [], chatTransactions: [] };
}

export interface ChatServiceOptions {
  clock?: () => Date;
  fs?: StoreFileSystem;
  /** Where proposals come from; defaults to the placeholder (no model). */
  proposer?: Proposer;
  /** Finance connector for commands; without it every proposal is rejected. */
  finance?: FinanceCommandPort;
  /** Largest amount a proposal may carry, in cents. */
  maxAmountCents?: number;
}

interface UndoEntry {
  plan: UndoPlan;
  threadId: string;
  proposalId: string;
  expiresAt: number;
}

/**
 * Text chat threads, one JSON file per thread in `.viral/dashboard/chat/`. Messages may turn into proposed
 * actions, which are validated in plain code and stored as pending; only confirming a proposal writes data.
 * Nothing is deleted automatically; a thread lives until the owner deletes it.
 */
export class ChatService {
  private readonly stores = new Map<string, JsonDocumentStore<ChatThreadDocument>>();
  private readonly clock: () => Date;
  private readonly fs: StoreFileSystem;
  private readonly proposer: Proposer;
  private readonly finance: FinanceCommandPort | undefined;
  private readonly maxAmountCents: number;
  /** Undo tokens live in memory only: they are valid for 10 seconds, so a restart simply ends the window. */
  private readonly undoTokens = new Map<string, UndoEntry>();
  private lastWriteToken: string | null = null;
  /** Confirm, cancel and undo run one at a time so a proposal can never be applied twice. */
  private commandQueue: Promise<unknown> = Promise.resolve();

  constructor(readonly directory: string, options: ChatServiceOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.fs = options.fs ?? nodeFs;
    this.proposer = options.proposer ?? new PlaceholderProposer();
    this.finance = options.finance;
    this.maxAmountCents = options.maxAmountCents ?? 500_000;
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.commandQueue.then(work, work);
    this.commandQueue = next.catch(() => undefined);
    return next;
  }

  private store(id: string): JsonDocumentStore<ChatThreadDocument> {
    let store = this.stores.get(id);
    if (!store) {
      const timestamp = this.now();
      // Only Main is created when its file is missing; any other missing thread file means the thread is gone.
      store = new JsonDocumentStore(join(this.directory, `${id}.json`), validateThread, (): ChatThreadDocument => {
        if (id !== mainThreadId) throw new NotFoundError("chat thread", id);
        return emptyThread(mainThreadId, "Main", timestamp);
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
    if (!(await this.fileExists(id))) {
      this.stores.delete(id);
      throw new NotFoundError("chat thread", id);
    }
    return this.store(id);
  }

  private async threadIds(): Promise<string[]> {
    await this.existing(mainThreadId);
    return (await nodeFs.readdir(this.directory)).filter((file) => file.endsWith(".json") && threadIdPattern.test(file.slice(0, -5))).map((file) => file.slice(0, -5));
  }

  private status(proposal: StoredProposal): ProposalStatus {
    return proposal.status === "pending" && Date.parse(proposal.expiresAt) <= this.clock().getTime() ? "expired" : proposal.status;
  }

  private view(threadId: string, proposal: StoredProposal): ProposalView {
    return { id: proposal.id, threadId, action: proposal.action.action, preview: proposal.preview, flags: proposal.flags, createdAt: proposal.createdAt, expiresAt: proposal.expiresAt, status: this.status(proposal) };
  }

  /** Main first, then the other threads oldest first. */
  async listThreads(): Promise<ChatThreadSummary[]> {
    const threads = await Promise.all((await this.threadIds()).map(async (id) => summary(await this.store(id).read())));
    return threads.sort((left, right) => Number(right.main) - Number(left.main) || left.createdAt.localeCompare(right.createdAt) || left.name.localeCompare(right.name));
  }

  async createThread(body: unknown): Promise<ChatThreadSummary> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["name"]);
    const name = threadName(input.name);
    const id = randomUUID();
    const timestamp = this.now();
    const store = new JsonDocumentStore(join(this.directory, `${id}.json`), validateThread, () => emptyThread(id, name, timestamp), this.fs);
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

  /** Messages oldest first; proposal messages carry the proposal's current status (pending, confirmed, expired, ...). */
  async listMessages(id: string): Promise<ChatMessageView[]> {
    const thread = await (await this.existing(id)).read();
    return thread.messages.map((message) => {
      const proposal = message.proposalId ? thread.proposals.find((candidate) => candidate.id === message.proposalId) : undefined;
      return proposal ? { ...message, proposal: this.view(thread.id, proposal) } : message;
    });
  }

  /**
   * Stores the owner's message and answers it. The answer is a plain reply, a pending proposal with a preview
   * line, or the list of validation errors. This never writes Finance data; only confirm does.
   */
  async postMessage(id: string, body: unknown): Promise<PostResult> {
    const store = await this.existing(id);
    const input = requireObject(body);
    rejectUnknownFields(input, ["text"]);
    const text = messageText(input.text);
    const today = localIsoDate(this.clock());
    const proposed = await this.proposer.propose({ threadId: id, text, today });

    let reply: Omit<ChatMessage, "id" | "createdAt">;
    let pending: StoredProposal | undefined;
    let errors: string[] | undefined;
    if (proposed.kind === "reply") {
      reply = { role: "assistant", kind: "text", text: proposed.text || placeholderReply };
    } else if (!this.finance) {
      errors = ["Chat commands are not available: no Finance connection is configured."];
      reply = { role: "assistant", kind: "invalid", text: errors[0]!, errors };
    } else {
      const snapshot = await this.finance.snapshot();
      const thread = await store.read();
      const result = validateProposal(proposed.proposal, {
        today, maxAmountCents: this.maxAmountCents, categories: snapshot.categories, transactions: snapshot.transactions, targets: snapshot.targets,
        lastChatTransactionId: thread.chatTransactions.at(-1)?.transactionId ?? null
      });
      if (!result.ok) {
        errors = result.errors;
        reply = { role: "assistant", kind: "invalid", text: `I can't do that yet:\n${errors.map((error) => `• ${error}`).join("\n")}`, errors };
      } else if (result.action.action === "get_balance") {
        reply = { role: "assistant", kind: "text", text: await balanceReply(this.finance, today) };
      } else {
        const created = this.clock();
        pending = {
          id: randomBytes(4).toString("hex"), action: result.action, preview: result.preview, flags: result.flags, createdAt: created.toISOString(),
          expiresAt: new Date(created.getTime() + proposalLifetimeMs).toISOString(), status: "pending", resolvedAt: null
        };
        reply = { role: "assistant", kind: "proposal", text: result.preview, proposalId: pending.id };
      }
    }

    const saved = await store.update((thread) => {
      const timestamp = this.now();
      const message: ChatMessage = { id: randomUUID(), role: "user", kind: "text", text, createdAt: timestamp };
      const answer: ChatMessage = { id: randomUUID(), createdAt: timestamp, ...reply };
      thread.messages.push(message, answer);
      if (pending) thread.proposals.push(pending);
      thread.updatedAt = timestamp;
      return { message, reply: answer };
    });
    const outcome = pending ? "proposal" : errors ? "invalid" : "reply";
    return { outcome, ...saved, ...(pending ? { proposal: this.view(id, pending) } : {}), ...(errors ? { errors } : {}) };
  }

  /** Finds a proposal by its short id across all threads. */
  private async findProposal(proposalId: string): Promise<{ threadId: string; store: JsonDocumentStore<ChatThreadDocument>; proposal: StoredProposal }> {
    if (!proposalIdPattern.test(proposalId)) throw new NotFoundError("proposal", proposalId);
    for (const threadId of await this.threadIds()) {
      const store = this.store(threadId);
      const proposal = (await store.read()).proposals.find((candidate) => candidate.id === proposalId);
      if (proposal) return { threadId, store, proposal };
    }
    throw new NotFoundError("proposal", proposalId);
  }

  private requirePending(proposal: StoredProposal): void {
    const status = this.status(proposal);
    if (status === "expired") throw new ValidationError(`Proposal ${proposal.id} expired at ${proposal.expiresAt}; send the request again`);
    if (status !== "pending") throw new ValidationError(`Proposal ${proposal.id} is already ${status}`);
  }

  private resultMessage(text: string, proposalId: string): ChatMessage {
    return { id: randomUUID(), role: "assistant", kind: "result", text, createdAt: this.now(), proposalId };
  }

  /** Runs a pending proposal. The only chat path that writes Finance data. Returns the saved entry and a 10-second undo token. */
  confirm(proposalId: string): Promise<ConfirmResult> {
    return this.serialize(async () => {
      const finance = this.finance;
      if (!finance) throw new ValidationError("Chat commands are not available: no Finance connection is configured");
      const { threadId, store, proposal } = await this.findProposal(proposalId);
      this.requirePending(proposal);
      let executed: ExecutionResult;
      try { executed = await executeAction(proposal.action, finance); }
      catch (error) {
        if (error instanceof ValidationError || error instanceof NotFoundError) throw new ValidationError(`This proposal can no longer be applied: ${error.message}`);
        throw error;
      }
      let updated: StoredProposal;
      try {
        updated = await store.update((thread) => {
          const stored = thread.proposals.find((candidate) => candidate.id === proposalId)!;
          stored.status = "confirmed";
          stored.resolvedAt = this.now();
          if (executed.createdTransactionId) thread.chatTransactions.push({ transactionId: executed.createdTransactionId, createdAt: this.now() });
          thread.messages.push(this.resultMessage(`Done: ${proposal.preview}`, proposalId));
          thread.updatedAt = this.now();
          return stored;
        });
      } catch (error) {
        // Keep Finance and the chat record consistent: if the thread cannot be saved, reverse the write.
        await undoAction(executed.undo, finance).catch(() => undefined);
        throw error;
      }
      const token = randomUUID();
      const expiresAt = this.clock().getTime() + undoWindowMs;
      this.undoTokens.set(token, { plan: executed.undo, threadId, proposalId, expiresAt });
      this.lastWriteToken = token;
      return { proposal: this.view(threadId, updated), entry: executed.entry, undo: { token, expiresAt: new Date(expiresAt).toISOString() } };
    });
  }

  /** Discards a pending proposal; nothing is written to Finance. */
  cancel(proposalId: string): Promise<ProposalView> {
    return this.serialize(async () => {
      const { threadId, store, proposal } = await this.findProposal(proposalId);
      this.requirePending(proposal);
      const updated = await store.update((thread) => {
        const stored = thread.proposals.find((candidate) => candidate.id === proposalId)!;
        stored.status = "cancelled";
        stored.resolvedAt = this.now();
        thread.messages.push(this.resultMessage(`Cancelled: ${proposal.preview}`, proposalId));
        thread.updatedAt = this.now();
        return stored;
      });
      return this.view(threadId, updated);
    });
  }

  /** Reverses the most recent chat write, within 10 seconds of confirming it. Each token works once. */
  /** `proposal` is null only if its thread was deleted in the meantime. */
  undo(token: string): Promise<{ proposal: ProposalView | null; restored: unknown }> {
    return this.serialize(async () => {
      const finance = this.finance;
      const entry = undoTokenPattern.test(token) ? this.undoTokens.get(token) : undefined;
      if (!entry || !finance) throw new NotFoundError("undo token", token);
      if (this.clock().getTime() > entry.expiresAt) {
        this.undoTokens.delete(token);
        throw new ValidationError(`The ${undoWindowMs / 1_000}-second undo window has passed`);
      }
      if (token !== this.lastWriteToken) throw new ValidationError("Only the most recent chat change can be undone");
      const restored = await undoAction(entry.plan, finance);
      this.undoTokens.delete(token);
      this.lastWriteToken = null;
      const store = await this.existing(entry.threadId).catch(() => null);
      let view: ProposalView | null = null;
      if (store) {
        const updated = await store.update((thread) => {
          const stored = thread.proposals.find((candidate) => candidate.id === entry.proposalId);
          if (stored) { stored.status = "undone"; stored.resolvedAt = this.now(); }
          if (entry.plan.kind === "delete-created") {
            const removed = entry.plan.transactionId;
            thread.chatTransactions = thread.chatTransactions.filter((item) => item.transactionId !== removed);
          }
          thread.messages.push(this.resultMessage(`Undone: ${stored?.preview ?? "last chat change"}`, entry.proposalId));
          thread.updatedAt = this.now();
          return stored;
        });
        if (updated) view = this.view(entry.threadId, updated);
      }
      return { proposal: view, restored };
    });
  }
}
