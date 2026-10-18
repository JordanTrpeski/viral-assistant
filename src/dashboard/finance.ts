import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NotFoundError, ValidationError } from "./errors.js";
import { localIsoDate, monthOf, type IsoDate, type IsoMonth } from "./shared/dates.js";
import { JsonDocumentStore, type StoreFileSystem } from "./store.js";
import {
  isObject, optionalText, rejectUnknownFields, requireCents, requireDate, requireMonth, requireNonNegativeCents,
  requireObject, requireOneOf, requirePositiveCents, requireText
} from "./validation.js";

export const categoryKinds = ["fixed", "flexible", "income"] as const;
export type CategoryKind = typeof categoryKinds[number];

export const transactionKinds = ["expense", "income", "bill"] as const;
export type TransactionKind = typeof transactionKinds[number];

export const transactionFilters = ["all", "fixed", "flexible", "income"] as const;
export type TransactionFilter = typeof transactionFilters[number];

export type TransactionSource = "manual" | "groceries" | "chat";

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
}

export interface Transaction {
  id: string;
  kind: TransactionKind;
  categoryId: string;
  amountCents: number;
  date: IsoDate;
  note: string;
  /** True for bills in Fixed categories; derived from the category, stored for readers of the raw file. */
  fixed: boolean;
  source: TransactionSource;
  createdAt: string;
  updatedAt: string;
}

/** Targets apply to Flexible categories only; zero means "no target". */
export interface BudgetTarget {
  categoryId: string;
  weeklyCents: number;
  monthlyCents: number;
}

export interface FinanceSettings {
  /** Balance before the first recorded transaction; may be zero or negative. */
  openingBalanceCents: number;
}

export interface FinanceDocument {
  schemaVersion: 1;
  categories: Category[];
  transactions: Transaction[];
  targets: BudgetTarget[];
  settings: FinanceSettings;
}

export interface TransactionInput {
  categoryId: string;
  amountCents: number;
  date: IsoDate;
  note?: string;
  kind?: TransactionKind;
  source?: TransactionSource;
}

export const defaultCategories: readonly Category[] = [
  { id: "rent", name: "Rent", kind: "fixed" },
  { id: "phone", name: "Phone", kind: "fixed" },
  { id: "subscriptions", name: "Subscriptions", kind: "fixed" },
  { id: "groceries", name: "Groceries", kind: "flexible" },
  { id: "entertainment", name: "Entertainment", kind: "flexible" },
  { id: "transport", name: "Transport", kind: "flexible" },
  { id: "salary", name: "Salary", kind: "income" }
];

export function emptyFinanceDocument(): FinanceDocument {
  return { schemaVersion: 1, categories: defaultCategories.map((category) => ({ ...category })), transactions: [], targets: [], settings: { openingBalanceCents: 0 } };
}

/** The only kind a transaction in a category of this kind can have. */
export function transactionKindFor(kind: CategoryKind): TransactionKind {
  return kind === "income" ? "income" : kind === "fixed" ? "bill" : "expense";
}

function validateCategory(value: unknown, index: number): Category {
  if (!isObject(value)) throw new Error(`categories[${index}] must be an object`);
  if (typeof value.id !== "string" || !value.id) throw new Error(`categories[${index}].id must be a string`);
  return { id: value.id, name: requireText(value.name, `categories[${index}].name`), kind: requireOneOf(value.kind, categoryKinds, `categories[${index}].kind`) };
}

function validateTransaction(value: unknown, index: number): Transaction {
  if (!isObject(value)) throw new Error(`transactions[${index}] must be an object`);
  const label = `transactions[${index}]`;
  if (typeof value.id !== "string" || !value.id) throw new Error(`${label}.id must be a string`);
  if (typeof value.categoryId !== "string") throw new Error(`${label}.categoryId must be a string`);
  if (typeof value.fixed !== "boolean") throw new Error(`${label}.fixed must be a boolean`);
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") throw new Error(`${label} timestamps must be strings`);
  return {
    id: value.id,
    kind: requireOneOf(value.kind, transactionKinds, `${label}.kind`),
    categoryId: value.categoryId,
    amountCents: requirePositiveCents(value.amountCents, `${label}.amountCents`),
    date: requireDate(value.date, `${label}.date`),
    note: optionalText(value.note, `${label}.note`),
    fixed: value.fixed,
    source: requireOneOf(value.source, ["manual", "groceries", "chat"] as const, `${label}.source`),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function validateTarget(value: unknown, index: number): BudgetTarget {
  if (!isObject(value) || typeof value.categoryId !== "string") throw new Error(`targets[${index}] must be an object with a categoryId`);
  return {
    categoryId: value.categoryId,
    weeklyCents: requireNonNegativeCents(value.weeklyCents, `targets[${index}].weeklyCents`),
    monthlyCents: requireNonNegativeCents(value.monthlyCents, `targets[${index}].monthlyCents`)
  };
}

export function validateFinanceDocument(value: unknown): FinanceDocument {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error("finance data must be an object with schemaVersion 1");
  if (!Array.isArray(value.categories) || !Array.isArray(value.transactions) || !Array.isArray(value.targets)) {
    throw new Error("finance data must contain categories, transactions and targets arrays");
  }
  const settings = isObject(value.settings) ? value.settings : {};
  return {
    schemaVersion: 1,
    categories: value.categories.map(validateCategory),
    transactions: value.transactions.map(validateTransaction),
    targets: value.targets.map(validateTarget),
    settings: { openingBalanceCents: requireCents(settings.openingBalanceCents ?? 0, "settings.openingBalanceCents") }
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "category";
}

function findCategory(document: FinanceDocument, id: string): Category {
  const category = document.categories.find((candidate) => candidate.id === id);
  if (!category) throw new NotFoundError("category", id);
  return category;
}

/** Like findCategory, but an unknown category inside a payload is a validation error (400), not a missing resource. */
function requireKnownCategory(document: FinanceDocument, id: unknown): Category {
  if (typeof id !== "string" || !id) throw new ValidationError("categoryId must be a non-empty string");
  const category = document.categories.find((candidate) => candidate.id === id);
  if (!category) throw new ValidationError(`Unknown category: ${id}`);
  return category;
}

function findTransaction(document: FinanceDocument, id: string): Transaction {
  const transaction = document.transactions.find((candidate) => candidate.id === id);
  if (!transaction) throw new NotFoundError("transaction", id);
  return transaction;
}

function checkKind(category: Category, kind: unknown): TransactionKind {
  const expected = transactionKindFor(category.kind);
  if (kind !== undefined && kind !== expected) {
    throw new ValidationError(`A ${category.kind} category (${category.name}) only takes ${expected} transactions, not ${String(kind)}`);
  }
  return expected;
}

function uniqueName(document: FinanceDocument, name: string, exceptId?: string): void {
  if (document.categories.some((category) => category.id !== exceptId && category.name.toLowerCase() === name.toLowerCase())) {
    throw new ValidationError(`A category named ${name} already exists`);
  }
}

function sortTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt));
}

export interface FinanceServiceOptions {
  clock?: () => Date;
  fs?: StoreFileSystem;
}

/** Owns `.viral/finance/finance.json`: categories, transactions, budget targets and the opening balance. */
export class FinanceService {
  private readonly clock: () => Date;

  constructor(readonly store: JsonDocumentStore<FinanceDocument>, clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  static open(directory: string, options: FinanceServiceOptions = {}): FinanceService {
    const store = new JsonDocumentStore(join(directory, "finance.json"), validateFinanceDocument, emptyFinanceDocument, options.fs);
    return new FinanceService(store, options.clock);
  }

  today(): IsoDate {
    return localIsoDate(this.clock());
  }

  async snapshot(): Promise<FinanceDocument> {
    return this.store.read();
  }

  async listCategories(): Promise<Category[]> {
    return (await this.store.read()).categories;
  }

  async createCategory(body: unknown): Promise<Category> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["name", "kind"]);
    const name = requireText(input.name, "name", 60);
    const kind = requireOneOf(input.kind, categoryKinds, "kind");
    return this.store.update((document) => {
      uniqueName(document, name);
      let id = slug(name);
      for (let suffix = 2; document.categories.some((category) => category.id === id); suffix += 1) id = `${slug(name)}-${suffix}`;
      const category: Category = { id, name, kind };
      document.categories.push(category);
      return category;
    });
  }

  async updateCategory(id: string, body: unknown): Promise<Category> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["name", "kind"]);
    const name = input.name === undefined ? undefined : requireText(input.name, "name", 60);
    const kind = input.kind === undefined ? undefined : requireOneOf(input.kind, categoryKinds, "kind");
    return this.store.update((document) => {
      const category = findCategory(document, id);
      if (name !== undefined) {
        uniqueName(document, name, id);
        category.name = name;
      }
      if (kind !== undefined && kind !== category.kind) {
        if (document.transactions.some((transaction) => transaction.categoryId === id)) {
          throw new ValidationError(`Cannot change ${category.name} to ${kind}: it already has transactions`);
        }
        category.kind = kind;
        if (kind !== "flexible") document.targets = document.targets.filter((target) => target.categoryId !== id);
      }
      return category;
    });
  }

  async deleteCategory(id: string): Promise<void> {
    return this.store.update((document) => {
      const category = findCategory(document, id);
      const used = document.transactions.filter((transaction) => transaction.categoryId === id).length;
      if (used) throw new ValidationError(`Cannot delete ${category.name}: ${used} transaction(s) use it`);
      document.categories = document.categories.filter((candidate) => candidate.id !== id);
      document.targets = document.targets.filter((target) => target.categoryId !== id);
    });
  }

  async listTransactions(filter: { month?: IsoMonth; type?: TransactionFilter } = {}): Promise<Transaction[]> {
    const month = filter.month === undefined ? undefined : requireMonth(filter.month);
    const type = filter.type === undefined ? "all" : requireOneOf(filter.type, transactionFilters, "type");
    const document = await this.store.read();
    const kinds = new Map(document.categories.map((category) => [category.id, category.kind]));
    return sortTransactions(document.transactions.filter((transaction) =>
      (month === undefined || monthOf(transaction.date) === month) && (type === "all" || kinds.get(transaction.categoryId) === type)));
  }

  async getTransaction(id: string): Promise<Transaction> {
    return findTransaction(await this.store.read(), id);
  }

  async createTransaction(body: unknown): Promise<Transaction> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["categoryId", "amountCents", "date", "note", "kind", "source"]);
    const amountCents = requirePositiveCents(input.amountCents);
    const date = requireDate(input.date);
    const note = optionalText(input.note, "note");
    const source = input.source === undefined ? "manual" : requireOneOf(input.source, ["manual", "groceries", "chat"] as const, "source");
    return this.store.update((document) => {
      const category = requireKnownCategory(document, input.categoryId);
      const kind = checkKind(category, input.kind);
      const timestamp = this.clock().toISOString();
      const transaction: Transaction = {
        id: randomUUID(), kind, categoryId: category.id, amountCents, date, note,
        fixed: category.kind === "fixed", source, createdAt: timestamp, updatedAt: timestamp
      };
      document.transactions.push(transaction);
      return transaction;
    });
  }

  async updateTransaction(id: string, body: unknown): Promise<Transaction> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["categoryId", "amountCents", "date", "note", "kind"]);
    const amountCents = input.amountCents === undefined ? undefined : requirePositiveCents(input.amountCents);
    const date = input.date === undefined ? undefined : requireDate(input.date);
    const note = input.note === undefined ? undefined : optionalText(input.note, "note");
    return this.store.update((document) => {
      const transaction = findTransaction(document, id);
      const category = input.categoryId === undefined ? findCategory(document, transaction.categoryId) : requireKnownCategory(document, input.categoryId);
      const kind = checkKind(category, input.kind);
      transaction.categoryId = category.id;
      transaction.kind = kind;
      transaction.fixed = category.kind === "fixed";
      if (amountCents !== undefined) transaction.amountCents = amountCents;
      if (date !== undefined) transaction.date = date;
      if (note !== undefined) transaction.note = note;
      transaction.updatedAt = this.clock().toISOString();
      return transaction;
    });
  }

  /** Puts back an exact transaction record (same id and timestamps), e.g. to undo a delete. Its category must still exist. */
  async restoreTransaction(record: Transaction): Promise<Transaction> {
    const transaction = validateTransaction(record, 0);
    return this.store.update((document) => {
      if (document.transactions.some((candidate) => candidate.id === transaction.id)) throw new ValidationError(`Transaction ${transaction.id} already exists`);
      const category = requireKnownCategory(document, transaction.categoryId);
      checkKind(category, transaction.kind);
      document.transactions.push(transaction);
      return transaction;
    });
  }

  async deleteTransaction(id: string): Promise<void> {
    return this.store.update((document) => {
      findTransaction(document, id);
      document.transactions = document.transactions.filter((transaction) => transaction.id !== id);
    });
  }

  /** Targets for every Flexible category, with zero for categories that have none yet. */
  async listTargets(): Promise<BudgetTarget[]> {
    const document = await this.store.read();
    return targetsFor(document);
  }

  async setTarget(categoryId: string, body: unknown): Promise<BudgetTarget> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["weeklyCents", "monthlyCents"]);
    const weeklyCents = input.weeklyCents === undefined ? undefined : requireNonNegativeCents(input.weeklyCents, "weeklyCents");
    const monthlyCents = input.monthlyCents === undefined ? undefined : requireNonNegativeCents(input.monthlyCents, "monthlyCents");
    return this.store.update((document) => {
      const target = editableTarget(document, categoryId);
      if (weeklyCents !== undefined) target.weeklyCents = weeklyCents;
      if (monthlyCents !== undefined) target.monthlyCents = monthlyCents;
      return target;
    });
  }

  /** The − and + controls: moves one target by one step, never below zero. */
  async stepTarget(categoryId: string, body: unknown, stepCents: number): Promise<BudgetTarget> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["period", "direction"]);
    const period = requireOneOf(input.period, ["weekly", "monthly"] as const, "period");
    if (input.direction !== 1 && input.direction !== -1) throw new ValidationError("direction must be 1 or -1");
    const direction = input.direction;
    return this.store.update((document) => {
      const target = editableTarget(document, categoryId);
      const field = period === "weekly" ? "weeklyCents" : "monthlyCents";
      target[field] = Math.max(0, target[field] + direction * stepCents);
      return target;
    });
  }

  async getSettings(): Promise<FinanceSettings> {
    return (await this.store.read()).settings;
  }

  async updateSettings(body: unknown): Promise<FinanceSettings> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["openingBalanceCents"]);
    const openingBalanceCents = requireCents(input.openingBalanceCents, "openingBalanceCents");
    return this.store.update((document) => {
      document.settings.openingBalanceCents = openingBalanceCents;
      return document.settings;
    });
  }
}

export function targetsFor(document: FinanceDocument): BudgetTarget[] {
  return document.categories.filter((category) => category.kind === "flexible").map((category) =>
    document.targets.find((target) => target.categoryId === category.id) ?? { categoryId: category.id, weeklyCents: 0, monthlyCents: 0 });
}

function editableTarget(document: FinanceDocument, categoryId: string): BudgetTarget {
  const category = findCategory(document, categoryId);
  if (category.kind !== "flexible") throw new ValidationError(`Targets apply to Flexible categories only; ${category.name} is ${category.kind}`);
  let target = document.targets.find((candidate) => candidate.categoryId === categoryId);
  if (!target) {
    target = { categoryId, weeklyCents: 0, monthlyCents: 0 };
    document.targets.push(target);
  }
  return target;
}
