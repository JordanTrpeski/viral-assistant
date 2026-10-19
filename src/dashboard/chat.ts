import { randomBytes, randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";
import { actionNames, type ActionName, type RawProposal } from "./commands/actions.js";
import { findAmbiguity } from "./commands/ambiguity.js";
import { evaluateArithmetic } from "./commands/arithmetic.js";
import { balanceReply, executeAction, undoAction, type ExecutionResult, type FinanceCommandPort, type UndoPlan } from "./commands/execute.js";
import { PlaceholderProposer, placeholderReply, type Proposer } from "./commands/proposer.js";
import { eurosToCents, validateProposal, type ResolvedAction } from "./commands/validate.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { localIsoDate } from "./shared/dates.js";
import { formatCents } from "./shared/money.js";
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
/** text: plain reply · proposal: a pending action awaiting confirm · invalid: validation errors · result: outcome of confirm/cancel/undo · question: an ambiguous word awaiting a category. */
export type ChatMessageKind = "text" | "proposal" | "invalid" | "result" | "question";
export type ProposalStatus = "pending" | "confirmed" | "cancelled" | "undone" | "expired";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  kind: ChatMessageKind;
  proposalId?: string;
  clarificationId?: string;
  errors?: string[];
}

/** An ambiguous spending word awaiting a category choice. It becomes a normal pending proposal once answered. */
export interface StoredClarification {
  id: string;
  action: "add_expense" | "add_income";
  /** Raw amount/note/date from the model proposal, minus the category the user must choose. */
  fields: { amount: number; note?: string; date?: string };
  word: string;
  candidates: string[];
  preview: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "answered" | "cancelled";
  resolvedAt: string | null;
}

export interface ClarificationView {
  id: string;
  threadId: string;
  word: string;
  candidates: string[];
  preview: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "answered" | "cancelled" | "expired";
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
  clarifications: StoredClarification[];
  /** Transactions created from this thread, oldest first; the last one is what target "last" means. */
  chatTransactions: { transactionId: string; createdAt: string }[];
}

interface ChatRulesDocument {
  schemaVersion: 1;
  /** Ambiguous word → chosen category id, so the same exact word is not asked again. */
  rules: Record<string, string>;
}

export interface ChatThreadSummary {
  id: string;
  name: string;
  main: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export type ChatMessageView = ChatMessage & { proposal?: ProposalView; clarification?: ClarificationView };

export interface PostResult {
  outcome: "reply" | "proposal" | "invalid" | "question";
  message: ChatMessage;
  reply: ChatMessage;
  proposal?: ProposalView;
  clarification?: ClarificationView;
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
    if (typeof raw.clarificationId === "string") message.clarificationId = raw.clarificationId;
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
  const clarificationStatuses = ["pending", "answered", "cancelled"] as const;
  const clarifications = (Array.isArray(value.clarifications) ? value.clarifications : []).map((raw, index): StoredClarification => {
    if (!isObject(raw) || typeof raw.id !== "string" || (raw.action !== "add_expense" && raw.action !== "add_income") || !isObject(raw.fields)
      || typeof (raw.fields as Record<string, unknown>).amount !== "number" || typeof raw.word !== "string" || !Array.isArray(raw.candidates)
      || typeof raw.preview !== "string" || typeof raw.createdAt !== "string" || typeof raw.expiresAt !== "string"
      || !clarificationStatuses.includes(raw.status as typeof clarificationStatuses[number])) {
      throw new Error(`clarifications[${index}] is malformed`);
    }
    const rawFields = raw.fields as Record<string, unknown>;
    const fields: StoredClarification["fields"] = { amount: rawFields.amount as number };
    if (typeof rawFields.note === "string") fields.note = rawFields.note;
    if (typeof rawFields.date === "string") fields.date = rawFields.date;
    return {
      id: raw.id, action: raw.action, fields, word: raw.word, candidates: raw.candidates.map(String), preview: raw.preview,
      createdAt: raw.createdAt, expiresAt: raw.expiresAt, status: raw.status as StoredClarification["status"], resolvedAt: typeof raw.resolvedAt === "string" ? raw.resolvedAt : null
    };
  });
  const chatTransactions = (Array.isArray(value.chatTransactions) ? value.chatTransactions : []).map((raw, index) => {
    if (!isObject(raw) || typeof raw.transactionId !== "string" || typeof raw.createdAt !== "string") throw new Error(`chatTransactions[${index}] is malformed`);
    return { transactionId: raw.transactionId, createdAt: raw.createdAt };
  });
  return { schemaVersion: 1, id: value.id, name: value.name, createdAt: value.createdAt, updatedAt: value.updatedAt, messages, proposals, clarifications, chatTransactions };
}

function validateRules(value: unknown): ChatRulesDocument {
  if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.rules)) return { schemaVersion: 1, rules: {} };
  const rules: Record<string, string> = {};
  for (const [word, category] of Object.entries(value.rules)) if (typeof category === "string") rules[word.toLowerCase()] = category;
  return { schemaVersion: 1, rules };
}

function emptyRules(): ChatRulesDocument {
  return { schemaVersion: 1, rules: {} };
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
  return { schemaVersion: 1, id, name, createdAt: timestamp, updatedAt: timestamp, messages: [], proposals: [], clarifications: [], chatTransactions: [] };
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

const typedAmountRe = /(?:€\s*)?(\d+(?:\.\d+)?)/g;

/** The last concrete number a user typed, in cents, or null — used as the reference for a relative amount. */
function lastTypedAmountCents(text: string): number | null {
  let last: number | null = null;
  typedAmountRe.lastIndex = 0;
  for (let match = typedAmountRe.exec(text); match; match = typedAmountRe.exec(text)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) last = eurosToCents(value);
  }
  return last;
}

/** The amount a resolved action carries, in cents, or null when it has none (delete, get_balance, edit without amount). */
function amountCentsOf(action: ResolvedAction): number | null {
  if (action.action === "add_expense" || action.action === "add_income" || action.action === "set_budget_target") return action.amountCents;
  if (action.action === "edit_transaction") return action.changes.amountCents ?? null;
  return null;
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
  /** Remembered ambiguous-word → category choices, in `.viral/dashboard/chat-rules.json` (sibling of the chat dir). */
  private readonly rulesStore: JsonDocumentStore<ChatRulesDocument>;
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
    this.rulesStore = new JsonDocumentStore(join(dirname(directory), "chat-rules.json"), validateRules, emptyRules, this.fs);
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

  /**
   * The reference amount for a relative phrase: the most recent concrete amount in the thread — a number the
   * user typed, or a confirmed proposal's amount — walking newest to oldest. The model's own output is never
   * used, and a prior message that is itself a relative phrase is skipped so one guess cannot seed another.
   */
  private lastAmount(thread: ChatThreadDocument): number | null {
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index]!;
      if (message.role === "user" && message.kind === "text") {
        if (evaluateArithmetic(message.text, 0) !== null) continue;
        const cents = lastTypedAmountCents(message.text);
        if (cents !== null) return cents;
      } else if (message.role === "assistant" && message.kind === "proposal" && message.proposalId) {
        const proposal = thread.proposals.find((item) => item.id === message.proposalId);
        if (proposal && proposal.status === "confirmed") {
          const cents = amountCentsOf(proposal.action);
          if (cents !== null) return cents;
        }
      }
    }
    return null;
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
      if (proposal) return { ...message, proposal: this.view(thread.id, proposal) };
      const clarification = message.clarificationId ? thread.clarifications.find((candidate) => candidate.id === message.clarificationId) : undefined;
      return clarification ? { ...message, clarification: this.clarificationView(thread.id, clarification) } : message;
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
    let clarification: StoredClarification | undefined;
    let errors: string[] | undefined;
    if (proposed.kind === "reply") {
      reply = { role: "assistant", kind: "text", text: proposed.text || placeholderReply };
    } else if (!this.finance) {
      errors = ["Chat commands are not available: no Finance connection is configured."];
      reply = { role: "assistant", kind: "invalid", text: errors[0]!, errors };
    } else {
      const snapshot = await this.finance.snapshot();
      const thread = await store.read();
      const proposal = proposed.proposal;
      const rawFields = (typeof proposal.fields === "object" && proposal.fields !== null && !Array.isArray(proposal.fields) ? proposal.fields : {}) as Record<string, unknown>;
      // Arithmetic in code (not the model): a relative amount in the message is computed here and replaces the
      // model's amount; the model's output is never used as the reference. "split" is not calculated — it asks.
      const arithmetic = evaluateArithmetic(text, this.lastAmount(thread));
      let working: string | undefined;
      if (arithmetic?.kind === "split") {
        const question = `Do you want your share of ${formatCents(arithmetic.amountCents)}, or the total for everyone?`;
        errors = [question];
        reply = { role: "assistant", kind: "invalid", text: question, errors };
      } else if (arithmetic?.kind === "needs-reference") {
        const question = "Which amount should I use? There's no earlier amount in this chat yet — tell me the number.";
        errors = [question];
        reply = { role: "assistant", kind: "invalid", text: question, errors };
      } else {
        if (arithmetic?.kind === "value" && (proposal.action === "add_expense" || proposal.action === "add_income" || proposal.action === "set_budget_target")) {
          const modelCents = typeof rawFields.amount === "number" ? eurosToCents(rawFields.amount) : null;
          if (modelCents !== null && modelCents !== arithmetic.valueCents) {
            console.error(`[chat] arithmetic override: model amount ${modelCents}c replaced by code result ${arithmetic.valueCents}c for "${text}"`);
          }
          rawFields.amount = arithmetic.valueCents / 100;
          working = arithmetic.working;
        }
        const amount = rawFields.amount;
        // Ambiguous-word rule (code, not model): for a spending add whose message uses an ambiguous word and
        // names no category, apply a remembered category or ask — never guess.
        const ambiguity = (proposal.action === "add_expense" || proposal.action === "add_income") && typeof amount === "number" && amount > 0
          ? findAmbiguity(text, snapshot.categories) : null;
        const remembered = ambiguity ? (await this.rulesStore.read()).rules[ambiguity.word] : undefined;
        if (ambiguity && remembered !== undefined) rawFields.category = remembered;
        if (ambiguity && remembered === undefined) {
          const created = this.clock();
          const label = ambiguity.word.charAt(0).toUpperCase() + ambiguity.word.slice(1);
          const questionText = `${label}, ${formatCents(eurosToCents(amount as number))}. Which category?`;
          const fields: StoredClarification["fields"] = { amount: amount as number };
          if (typeof rawFields.note === "string") fields.note = rawFields.note;
          if (typeof rawFields.date === "string") fields.date = rawFields.date;
          clarification = {
            id: randomBytes(4).toString("hex"), action: proposal.action as "add_expense" | "add_income", fields, word: ambiguity.word, candidates: ambiguity.candidates,
            preview: questionText, createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + proposalLifetimeMs).toISOString(), status: "pending", resolvedAt: null
          };
          reply = { role: "assistant", kind: "question", text: questionText, clarificationId: clarification.id };
        } else {
          const result = validateProposal(proposal, {
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
            const preview = working ? `${result.preview} (${working})` : result.preview;
            pending = {
              id: randomBytes(4).toString("hex"), action: result.action, preview, flags: result.flags, createdAt: created.toISOString(),
              expiresAt: new Date(created.getTime() + proposalLifetimeMs).toISOString(), status: "pending", resolvedAt: null
            };
            reply = { role: "assistant", kind: "proposal", text: preview, proposalId: pending.id };
          }
        }
      }
    }

    const saved = await store.update((thread) => {
      const timestamp = this.now();
      const message: ChatMessage = { id: randomUUID(), role: "user", kind: "text", text, createdAt: timestamp };
      const answer: ChatMessage = { id: randomUUID(), createdAt: timestamp, ...reply };
      thread.messages.push(message, answer);
      if (pending) thread.proposals.push(pending);
      if (clarification) thread.clarifications.push(clarification);
      thread.updatedAt = timestamp;
      return { message, reply: answer };
    });
    const outcome = pending ? "proposal" : clarification ? "question" : errors ? "invalid" : "reply";
    return {
      outcome, ...saved,
      ...(pending ? { proposal: this.view(id, pending) } : {}),
      ...(clarification ? { clarification: this.clarificationView(id, clarification) } : {}),
      ...(errors ? { errors } : {})
    };
  }

  /** Turns an answered clarification into a normal pending proposal with the chosen category. Writes nothing to Finance. */
  answerClarification(clarificationId: string, body: unknown): Promise<{ proposal: ProposalView }> {
    return this.serialize(async () => {
      const finance = this.finance;
      if (!finance) throw new ValidationError("Chat commands are not available: no Finance connection is configured");
      const { threadId, store, clarification } = await this.findClarification(clarificationId);
      const status = this.clarificationStatus(clarification);
      if (status === "expired") throw new ValidationError(`Clarification ${clarification.id} expired at ${clarification.expiresAt}; send the request again`);
      if (status !== "pending") throw new ValidationError(`Clarification ${clarification.id} is already ${status}`);
      const input = requireObject(body);
      rejectUnknownFields(input, ["category"]);
      if (typeof input.category !== "string" || input.category.trim() === "") throw new ValidationError("category must be one of the suggested categories or a valid existing category");
      const snapshot = await finance.snapshot();
      const thread = await store.read();
      const raw: RawProposal = { action: clarification.action, fields: { ...clarification.fields, category: input.category } };
      const result = validateProposal(raw, {
        today: localIsoDate(this.clock()), maxAmountCents: this.maxAmountCents, categories: snapshot.categories, transactions: snapshot.transactions, targets: snapshot.targets,
        lastChatTransactionId: thread.chatTransactions.at(-1)?.transactionId ?? null
      });
      if (!result.ok) throw new ValidationError(result.errors.join("; "));
      if (result.action.action !== "add_expense" && result.action.action !== "add_income") throw new ValidationError("A clarification can only resolve to an add.");
      const chosenCategoryId = result.action.categoryId;
      const created = this.clock();
      const pending: StoredProposal = {
        id: randomBytes(4).toString("hex"), action: result.action, preview: result.preview, flags: result.flags, createdAt: created.toISOString(),
        expiresAt: new Date(created.getTime() + proposalLifetimeMs).toISOString(), status: "pending", resolvedAt: null
      };
      const updated = await store.update((document) => {
        const stored = document.clarifications.find((candidate) => candidate.id === clarificationId)!;
        stored.status = "answered";
        stored.resolvedAt = this.now();
        document.proposals.push(pending);
        document.messages.push({ id: randomUUID(), role: "assistant", kind: "proposal", text: result.preview, createdAt: this.now(), proposalId: pending.id });
        document.updatedAt = this.now();
        return pending;
      });
      // Remember the exact word → chosen category id, so the same word is not asked again.
      await this.rulesStore.update((rules) => { rules.rules[clarification.word] = chosenCategoryId; });
      return { proposal: this.view(threadId, updated) };
    });
  }

  private clarificationStatus(clarification: StoredClarification): ClarificationView["status"] {
    return clarification.status === "pending" && Date.parse(clarification.expiresAt) <= this.clock().getTime() ? "expired" : clarification.status;
  }

  private clarificationView(threadId: string, clarification: StoredClarification): ClarificationView {
    return {
      id: clarification.id, threadId, word: clarification.word, candidates: clarification.candidates, preview: clarification.preview,
      createdAt: clarification.createdAt, expiresAt: clarification.expiresAt, status: this.clarificationStatus(clarification)
    };
  }

  private async findClarification(id: string): Promise<{ threadId: string; store: JsonDocumentStore<ChatThreadDocument>; clarification: StoredClarification }> {
    if (!proposalIdPattern.test(id)) throw new NotFoundError("clarification", id);
    for (const threadId of await this.threadIds()) {
      const store = this.store(threadId);
      const clarification = (await store.read()).clarifications.find((candidate) => candidate.id === id);
      if (clarification) return { threadId, store, clarification };
    }
    throw new NotFoundError("clarification", id);
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
