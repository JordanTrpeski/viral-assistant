import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NotFoundError } from "../errors.js";
import { localIsoDate, type IsoDate } from "../shared/dates.js";
import { JsonDocumentStore, type StoreFileSystem } from "../store.js";
import { isObject } from "../validation.js";
import { createCandidate, normaliseItem, patchCandidate, validateItemsDocument, type ItemType, type ModelContext, type OrganiseItem } from "./model.js";

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

export interface ItemFilter {
  type?: ItemType;
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
    return items.filter((item) => filter.type === undefined || item.type === filter.type).sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  async getItem(id: string): Promise<OrganiseItem> {
    const item = (await this.items.read()).items.find((candidate) => candidate.id === id);
    if (!item) throw new NotFoundError("item", id);
    return item;
  }

  async createItem(body: unknown): Promise<OrganiseItem> {
    const candidate = createCandidate(body);
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
      const item = normaliseItem(patchCandidate(previous, body), previous, this.modelContext(document.items, lists));
      document.items[index] = item;
      return item;
    });
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
