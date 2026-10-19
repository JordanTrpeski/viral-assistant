import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NotFoundError, ValidationError } from "../errors.js";
import { localIsoDate, type IsoDate } from "../shared/dates.js";
import { JsonDocumentStore, type StoreFileSystem } from "../store.js";
import { isObject, rejectUnknownFields, requireObject } from "../validation.js";
import { createCandidate, maxTitleLength, normaliseItem, patchCandidate, validateItemsDocument, type ItemType, type ModelContext, type OrganiseItem } from "./model.js";
import type { JsonObject } from "../validation.js";
import { applyReminderRules, nextOccurrence } from "./reminders.js";

export interface OrganiseList {
  id: string;
  name: string;
  /** Allowed statuses in order; the last one counts as done. */
  statuses: string[];
  created_at: string;
  updated_at: string;
}

export interface ItemsDocument {
  schemaVersion: 1;
  items: OrganiseItem[];
}

export interface ListsDocument {
  schemaVersion: 1;
  lists: OrganiseList[];
}

function validateListsDocument(value: unknown): ListsDocument {
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.lists)) throw new Error("organise lists must be an object with schemaVersion 1 and a lists array");
  return value as unknown as ListsDocument;
}

export interface OrganiseServiceOptions {
  clock?: () => Date;
  fs?: StoreFileSystem;
}

/** Filters shared by every subpanel: type, project, status and a date range (on the item's date). */
export interface ItemFilter {
  type?: ItemType;
  project_id?: string;
  status?: string;
  from?: IsoDate;
  to?: IsoDate;
}

export function matchesFilter(item: OrganiseItem, filter: ItemFilter): boolean {
  if (filter.type !== undefined && item.type !== filter.type) return false;
  if (filter.project_id !== undefined && item.project_id !== filter.project_id) return false;
  if (filter.status !== undefined && item.status !== filter.status) return false;
  if ((filter.from !== undefined || filter.to !== undefined) && item.date === null) return false;
  if (filter.from !== undefined && item.date! < filter.from) return false;
  if (filter.to !== undefined && item.date! > filter.to) return false;
  return true;
}

/**
 * Owns `.viral/dashboard/organise/`: items.json (every item), lists.json (and, in later steps, trackers.json and
 * rules.json). Each file is written atomically through the shared JSON store.
 */
export class OrganiseService {
  readonly items: JsonDocumentStore<ItemsDocument>;
  readonly lists: JsonDocumentStore<ListsDocument>;
  readonly clock: () => Date;

  constructor(readonly directory: string, options: OrganiseServiceOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.items = new JsonDocumentStore(join(directory, "items.json"), validateItemsDocument, () => ({ schemaVersion: 1, items: [] }), options.fs);
    this.lists = new JsonDocumentStore(join(directory, "lists.json"), validateListsDocument, () => ({ schemaVersion: 1, lists: [] }), options.fs);
  }

  today(): IsoDate {
    return localIsoDate(this.clock());
  }

  /** The lookups validation needs, taken from the documents being changed. */
  protected modelContext(items: readonly OrganiseItem[], lists: readonly OrganiseList[]): ModelContext {
    const timestamp = this.clock().toISOString();
    return {
      items,
      listStatuses: (listId) => lists.find((list) => list.id === listId)?.statuses,
      newId: () => randomUUID(),
      now: () => timestamp
    };
  }

  async listItems(filter: ItemFilter = {}): Promise<OrganiseItem[]> {
    const items = (await this.items.read()).items;
    return items.filter((item) => matchesFilter(item, filter)).sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  async getItem(id: string): Promise<OrganiseItem> {
    const item = (await this.items.read()).items.find((candidate) => candidate.id === id);
    if (!item) throw new NotFoundError("item", id);
    return item;
  }

  async createItem(body: unknown): Promise<OrganiseItem> {
    const raw = createCandidate(body);
    const candidate = applyReminderRules(raw, raw, null);
    const lists = (await this.lists.read()).lists;
    return this.items.update((document) => {
      const item = normaliseItem(candidate, null, this.modelContext(document.items, lists));
      document.items.push(item);
      return item;
    });
  }

  async updateItem(id: string, body: unknown): Promise<OrganiseItem> {
    const lists = (await this.lists.read()).lists;
    return this.items.update((document) => {
      const index = document.items.findIndex((item) => item.id === id);
      if (index < 0) throw new NotFoundError("item", id);
      const previous = document.items[index]!;
      const context = this.modelContext(document.items, lists);
      const item = normaliseItem(applyReminderRules(patchCandidate(previous, body), body as JsonObject, previous), previous, context);
      document.items[index] = item;
      // Completing a recurring reminder: this occurrence goes to Done and the next one is created.
      if (item.type === "reminder" && item.status === "done" && previous.status !== "done") {
        const next = nextOccurrence(item);
        // Re-completing a reopened occurrence must not schedule the same next occurrence twice.
        const exists = next && document.items.some((other) => other.type === "reminder" && other.title === item.title && other.date === next.date && other.id !== item.id);
        if (next && !exists) document.items.push(normaliseItem(next, null, this.modelContext(document.items, lists)));
      }
      return item;
    });
  }

  // Inbox: capture first, sort later.

  /** Adds an inbox item whose title is the typed text. Nothing else is asked. */
  async addToInbox(body: unknown): Promise<OrganiseItem> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["text"]);
    if (typeof input.text !== "string") throw new ValidationError("text must be a string");
    const text = input.text.trim();
    if (text.length < 1 || text.length > maxTitleLength) throw new ValidationError(`text must be 1 to ${maxTitleLength} characters`);
    return this.createItem({ type: "inbox", title: text });
  }

  async inbox(): Promise<{ count: number; items: OrganiseItem[] }> {
    const items = await this.listItems({ type: "inbox" });
    return { count: items.length, items };
  }

  /**
   * Sorts an inbox item into a task, reminder, note or list item using that type's sort form.
   * The item keeps its id and creation time; only its type and the form's fields change.
   */
  async sortInbox(id: string, body: unknown): Promise<OrganiseItem> {
    const input = requireObject(body);
    const target = input.type;
    if (!(target === "task" || target === "reminder" || target === "note" || target === "list_item")) throw new ValidationError("type must be one of: task, reminder, note, list_item");
    rejectUnknownFields(input, ["type", ...sortFormFields[target]]);
    const lists = (await this.lists.read()).lists;
    return this.items.update((document) => {
      const index = document.items.findIndex((item) => item.id === id);
      if (index < 0) throw new NotFoundError("item", id);
      const previous = document.items[index]!;
      if (previous.type !== "inbox") throw new ValidationError("Only inbox items can be sorted");
      const candidate = applyReminderRules(sortCandidate(target, input, previous), input, previous);
      const item = normaliseItem(candidate, previous, this.modelContext(document.items, lists));
      document.items[index] = item;
      return item;
    });
  }

  async listLists(): Promise<OrganiseList[]> {
    return (await this.lists.read()).lists;
  }

  /** Deletes an item and removes it from every other item's links. */
  async deleteItem(id: string): Promise<void> {
    await this.items.update((document) => {
      if (!document.items.some((item) => item.id === id)) throw new NotFoundError("item", id);
      document.items = document.items.filter((item) => item.id !== id);
      for (const item of document.items) if (item.links.includes(id)) item.links = item.links.filter((link) => link !== id);
    });
  }
}

/** The sort form for each target type, as in the spec. Notes use `text` for their body and an optional single `link`. */
export const sortFormFields = {
  task: ["title", "date", "priority", "project_id", "checklist"],
  reminder: ["title", "date", "category", "project_id", "recurrence", "interval_days", "prepare_by", "prepare_days", "notes"],
  note: ["text", "project_id", "date", "link"],
  list_item: ["list_id", "status", "notes"]
} as const;

function sortCandidate(target: keyof typeof sortFormFields, input: JsonObject, previous: OrganiseItem): JsonObject {
  const base: JsonObject = { type: target, title: previous.title, notes: previous.notes, links: previous.links };
  if (target === "note") {
    const text = input.text === undefined ? previous.title : input.text;
    const link = input.link === undefined || input.link === null || input.link === "" ? [] : [input.link];
    return { ...base, notes: text, project_id: input.project_id, date: input.date, links: [...previous.links, ...link] };
  }
  const candidate: JsonObject = { ...base };
  for (const field of sortFormFields[target]) if (input[field] !== undefined) candidate[field] = input[field];
  return candidate;
}
