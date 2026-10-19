import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NotFoundError, ValidationError } from "../errors.js";
import { localIsoDate, type IsoDate } from "../shared/dates.js";
import { JsonDocumentStore, type StoreFileSystem } from "../store.js";
import { isObject, rejectUnknownFields, requireObject } from "../validation.js";
import { createCandidate, maxTitleLength, normaliseItem, patchCandidate, validateItemsDocument, type ItemType, type ModelContext, type OrganiseItem } from "./model.js";
import type { JsonObject } from "../validation.js";
import { applyReminderRules, nextOccurrence } from "./reminders.js";
import { listName, listStatuses, newListFields } from "./lists.js";
import { projectPage, type ProjectPage, type ProjectTracker } from "./projects.js";
import { weeklyReview, type WeeklyReview } from "./review.js";
import { entryFields, trackerFields, trackerView, validateTrackersDocument, type Tracker, type TrackerEntry, type TrackersDocument, type TrackerView } from "./trackers.js";

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
  readonly trackers: JsonDocumentStore<TrackersDocument>;
  readonly clock: () => Date;

  constructor(readonly directory: string, options: OrganiseServiceOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.items = new JsonDocumentStore(join(directory, "items.json"), validateItemsDocument, () => ({ schemaVersion: 1, items: [] }), options.fs);
    this.lists = new JsonDocumentStore(join(directory, "lists.json"), validateListsDocument, () => ({ schemaVersion: 1, lists: [] }), options.fs);
    this.trackers = new JsonDocumentStore(join(directory, "trackers.json"), validateTrackersDocument, () => ({ schemaVersion: 1, trackers: [], entries: [] }), options.fs);
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

  async getList(id: string): Promise<OrganiseList> {
    const list = (await this.lists.read()).lists.find((candidate) => candidate.id === id);
    if (!list) throw new NotFoundError("list", id);
    return list;
  }

  async createList(body: unknown): Promise<OrganiseList> {
    const fields = newListFields(body);
    const timestamp = this.clock().toISOString();
    return this.lists.update((document) => {
      const list: OrganiseList = { id: randomUUID(), ...fields, created_at: timestamp, updated_at: timestamp };
      document.lists.push(list);
      return list;
    });
  }

  /**
   * Renames a list or changes its statuses. A status still used by one of its rows cannot be removed. Afterwards
   * each row's done_at follows the (possibly new) last status.
   */
  async updateList(id: string, body: unknown): Promise<OrganiseList> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["name", "statuses"]);
    const name = input.name === undefined ? undefined : listName(input.name);
    const statuses = input.statuses === undefined ? undefined : listStatuses(input.statuses);
    const rows = (await this.items.read()).items.filter((item) => item.type === "list_item" && item.list_id === id);
    const updated = await this.lists.update((document) => {
      const list = document.lists.find((candidate) => candidate.id === id);
      if (!list) throw new NotFoundError("list", id);
      if (statuses) {
        const removed = [...new Set(rows.map((row) => row.status))].filter((status): status is string => status !== null && !statuses.includes(status));
        if (removed.length) throw new ValidationError(`Cannot remove status(es) still in use: ${removed.join(", ")}`);
        list.statuses = statuses;
      }
      if (name !== undefined) list.name = name;
      list.updated_at = this.clock().toISOString();
      return list;
    });
    if (statuses) {
      const last = updated.statuses.at(-1)!;
      await this.items.update((document) => {
        for (const item of document.items) {
          if (item.type !== "list_item" || item.list_id !== id) continue;
          if (item.status === last && item.done_at === null) item.done_at = this.clock().toISOString();
          if (item.status !== last && item.done_at !== null) item.done_at = null;
        }
      });
    }
    return updated;
  }

  /** A list can only be deleted once it has no rows. */
  async deleteList(id: string): Promise<void> {
    const rows = (await this.items.read()).items.filter((item) => item.type === "list_item" && item.list_id === id).length;
    await this.lists.update((document) => {
      if (!document.lists.some((list) => list.id === id)) throw new NotFoundError("list", id);
      if (rows) throw new ValidationError(`Cannot delete a list with ${rows} row(s); move or delete them first`);
      document.lists = document.lists.filter((list) => list.id !== id);
    });
  }

  protected async projectTrackers(): Promise<ProjectTracker[]> {
    return (await this.trackers.read()).trackers;
  }

  /** The rolling 7-day review ending on `end` (default today). */
  async review(end?: IsoDate): Promise<WeeklyReview> {
    const [items, lists, trackers] = await Promise.all([this.items.read(), this.lists.read(), this.trackers.read()]);
    return weeklyReview({ items: items.items, lists: lists.lists, trackers: trackers.trackers, entries: trackers.entries, end: end ?? this.today(), today: this.today() });
  }

  // Trackers: entries are stored separately from the tracker, in the same trackers.json.

  private async requireProject(projectId: string | null | undefined): Promise<void> {
    if (projectId === null || projectId === undefined) return;
    const project = (await this.items.read()).items.find((item) => item.id === projectId);
    if (!project || project.type !== "project") throw new ValidationError(`project_id ${projectId} is not an existing project`);
  }

  async listTrackers(): Promise<TrackerView[]> {
    const document = await this.trackers.read();
    return document.trackers.map((tracker) => trackerView(tracker, document.entries, this.today()));
  }

  async getTracker(id: string): Promise<TrackerView> {
    const document = await this.trackers.read();
    const tracker = document.trackers.find((candidate) => candidate.id === id);
    if (!tracker) throw new NotFoundError("tracker", id);
    return trackerView(tracker, document.entries, this.today());
  }

  async createTracker(body: unknown): Promise<TrackerView> {
    const fields = trackerFields(body, false);
    await this.requireProject(fields.project_id);
    const timestamp = this.clock().toISOString();
    const tracker = await this.trackers.update((document) => {
      const created = { id: randomUUID(), ...fields, created_at: timestamp, updated_at: timestamp } as Tracker;
      document.trackers.push(created);
      return created;
    });
    return this.getTracker(tracker.id);
  }

  async updateTracker(id: string, body: unknown): Promise<TrackerView> {
    const fields = trackerFields(body, true);
    await this.requireProject(fields.project_id);
    await this.trackers.update((document) => {
      const tracker = document.trackers.find((candidate) => candidate.id === id);
      if (!tracker) throw new NotFoundError("tracker", id);
      Object.assign(tracker, fields, { updated_at: this.clock().toISOString() });
    });
    return this.getTracker(id);
  }

  /** Deleting a tracker deletes its entries too. */
  async deleteTracker(id: string): Promise<void> {
    await this.trackers.update((document) => {
      if (!document.trackers.some((tracker) => tracker.id === id)) throw new NotFoundError("tracker", id);
      document.trackers = document.trackers.filter((tracker) => tracker.id !== id);
      document.entries = document.entries.filter((entry) => entry.tracker_id !== id);
    });
  }

  async listEntries(trackerId: string): Promise<TrackerEntry[]> {
    const document = await this.trackers.read();
    if (!document.trackers.some((tracker) => tracker.id === trackerId)) throw new NotFoundError("tracker", trackerId);
    return document.entries.filter((entry) => entry.tracker_id === trackerId).sort((left, right) => right.date.localeCompare(left.date) || right.created_at.localeCompare(left.created_at));
  }

  async addEntry(trackerId: string, body: unknown): Promise<TrackerEntry> {
    const fields = entryFields(body, false, this.today());
    const timestamp = this.clock().toISOString();
    return this.trackers.update((document) => {
      if (!document.trackers.some((tracker) => tracker.id === trackerId)) throw new NotFoundError("tracker", trackerId);
      const entry = { id: randomUUID(), tracker_id: trackerId, ...fields, created_at: timestamp, updated_at: timestamp } as TrackerEntry;
      document.entries.push(entry);
      return entry;
    });
  }

  async updateEntry(trackerId: string, entryId: string, body: unknown): Promise<TrackerEntry> {
    const fields = entryFields(body, true, this.today());
    return this.trackers.update((document) => {
      const entry = document.entries.find((candidate) => candidate.id === entryId && candidate.tracker_id === trackerId);
      if (!document.trackers.some((tracker) => tracker.id === trackerId)) throw new NotFoundError("tracker", trackerId);
      if (!entry) throw new NotFoundError("tracker entry", entryId);
      Object.assign(entry, fields, { updated_at: this.clock().toISOString() });
      return entry;
    });
  }

  async deleteEntry(trackerId: string, entryId: string): Promise<void> {
    await this.trackers.update((document) => {
      if (!document.trackers.some((tracker) => tracker.id === trackerId)) throw new NotFoundError("tracker", trackerId);
      if (!document.entries.some((entry) => entry.id === entryId && entry.tracker_id === trackerId)) throw new NotFoundError("tracker entry", entryId);
      document.entries = document.entries.filter((entry) => entry.id !== entryId);
    });
  }

  async projectPage(id: string): Promise<ProjectPage> {
    const project = await this.getItem(id);
    if (project.type !== "project") throw new NotFoundError("project", id);
    return projectPage(project, (await this.items.read()).items, await this.listLists(), await this.projectTrackers());
  }

  /**
   * Deletes an item and removes it from every other item's links. A project is refused while anything still
   * belongs to it (items or trackers): unassign or delete those first.
   */
  async deleteItem(id: string): Promise<void> {
    const trackers = await this.projectTrackers();
    await this.items.update((document) => {
      const target = document.items.find((item) => item.id === id);
      if (!target) throw new NotFoundError("item", id);
      if (target.type === "project") {
        const items = document.items.filter((item) => item.project_id === id).length;
        const tracked = trackers.filter((tracker) => tracker.project_id === id).length;
        if (items || tracked) throw new ValidationError(`Cannot delete project ${target.title}: ${[items ? `${items} item(s)` : "", tracked ? `${tracked} tracker(s)` : ""].filter(Boolean).join(" and ")} still belong to it`);
      }
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
