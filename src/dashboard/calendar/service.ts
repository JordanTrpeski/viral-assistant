// Calendar v2 service (phase 1): owns .viral/calendar/store.json and implements the data-model rules from
// docs/design/calendar-v2.md. No Google, no routes, no screens. Every date/time rule uses an injected clock.
import { randomUUID } from "node:crypto";
import { ValidationError, NotFoundError } from "../errors.js";
import { addDays, localIsoDate, type IsoDate } from "../shared/dates.js";
import { JsonDocumentStore, type StoreFileSystem } from "../store.js";
import {
  defaultCategories, emptyCalendarDocument, validateCalendarDocument,
  itemKinds, priorities, recurrenceFreqs,
  type CalendarDocument, type Category, type Item, type ItemKind, type Priority, type Recurrence, type RecurrenceFreq, type Settings, type Subcategory, type TrashEntry
} from "./model.js";
import { occurrences } from "./recurrence.js";
import { reminderTimes, type ReminderTime } from "./reminders.js";

const undoWindowMs = 10_000;

export interface CalendarServiceOptions {
  clock?: () => Date;
  fs?: StoreFileSystem;
}

export interface CategoryInput {
  name: string;
  colour?: string | null;
  subcategories?: { name: string }[];
  defaultLeadTimes?: number[];
}

export interface ItemInput {
  kind: ItemKind;
  title: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  allDay?: boolean;
  date: IsoDate;
  time?: string | null;
  timeZone?: string;
  dueDate?: IsoDate | null;
  plannedDate?: IsoDate | null;
  priority?: Priority;
  recurrence?: { freq: RecurrenceFreq; anchor?: IsoDate } | null;
  leadTimes?: number[] | null;
}

export type DeleteScope = "occurrence" | "future" | "series";

interface UndoState {
  expiresAt: number;
  label: "delete" | "complete";
  items: Item[];
  trash: TrashEntry[];
  doneLog: CalendarDocument["doneLog"];
}

const timePattern = /^\d{2}:\d{2}$/;

export class CalendarService {
  readonly store: JsonDocumentStore<CalendarDocument>;
  private readonly clock: () => Date;
  private undo_: UndoState | null = null;

  constructor(path: string, options: CalendarServiceOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.store = new JsonDocumentStore(path, validateCalendarDocument, emptyCalendarDocument, options.fs);
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private todayDate(): IsoDate {
    return localIsoDate(this.clock());
  }

  /** Purges trash whose 7-day window has passed. Called at the start of every public operation ("on load"). */
  private async purge(): Promise<void> {
    const nowMs = this.clock().getTime();
    const document = await this.store.read();
    if (!document.trash.some((entry) => Date.parse(entry.expiresAt) <= nowMs)) return;
    await this.store.update((draft) => { draft.trash = draft.trash.filter((entry) => Date.parse(entry.expiresAt) > nowMs); });
  }

  private rememberUndo(label: "delete" | "complete", before: CalendarDocument): void {
    this.undo_ = {
      expiresAt: this.clock().getTime() + undoWindowMs,
      label,
      items: structuredClone(before.items),
      trash: structuredClone(before.trash),
      doneLog: structuredClone(before.doneLog)
    };
  }

  // ---- Settings -----------------------------------------------------------

  async getSettings(): Promise<Settings> {
    await this.purge();
    return (await this.store.read()).settings;
  }

  /** Changes stored settings (the default time zone, all-day reminder time, trash days). Items keep their own zone. */
  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    await this.purge();
    return this.store.update((draft) => {
      if (patch.timeZone !== undefined) {
        if (typeof patch.timeZone !== "string" || patch.timeZone.trim() === "") throw new ValidationError("timeZone must be a non-empty IANA zone name");
        draft.settings.timeZone = patch.timeZone;
      }
      if (patch.allDayReminderTime !== undefined) {
        if (!timePattern.test(patch.allDayReminderTime)) throw new ValidationError("allDayReminderTime must be HH:MM");
        draft.settings.allDayReminderTime = patch.allDayReminderTime;
      }
      if (patch.trashDays !== undefined) {
        if (!Number.isInteger(patch.trashDays) || patch.trashDays <= 0) throw new ValidationError("trashDays must be a positive whole number");
        draft.settings.trashDays = patch.trashDays;
      }
      return draft.settings;
    });
  }

  // ---- Categories ---------------------------------------------------------

  async listCategories(): Promise<Category[]> {
    await this.purge();
    return (await this.store.read()).categories;
  }

  /** Seeds the seven default categories (with subcategories and lead times) only on a fresh store. Returns whether it seeded. */
  async seedDefaultCategoriesIfEmpty(): Promise<boolean> {
    await this.purge();
    if ((await this.store.read()).categories.length > 0) return false; // existing categories are never changed
    for (const seed of defaultCategories) {
      await this.createCategory({ name: seed.name, subcategories: seed.subcategories.map((name) => ({ name })), defaultLeadTimes: seed.defaultLeadTimes });
    }
    return true;
  }

  async createCategory(input: CategoryInput): Promise<Category> {
    await this.purge();
    const name = requireName(input.name, "name");
    const category: Category = {
      id: randomUUID(),
      name,
      colour: input.colour ?? null,
      subcategories: (input.subcategories ?? []).map((sub) => ({ id: randomUUID(), name: requireName(sub.name, "subcategory name") })),
      defaultLeadTimes: requireWholeDays(input.defaultLeadTimes ?? [], "defaultLeadTimes"),
      created: this.now()
    };
    return this.store.update((draft) => { draft.categories.push(category); return category; });
  }

  async addSubcategory(categoryId: string, name: string): Promise<Subcategory> {
    await this.purge();
    const subcategory: Subcategory = { id: randomUUID(), name: requireName(name, "subcategory name") };
    return this.store.update((draft) => {
      const category = draft.categories.find((candidate) => candidate.id === categoryId);
      if (!category) throw new NotFoundError("category", categoryId);
      category.subcategories.push(subcategory);
      return subcategory;
    });
  }

  async renameCategory(categoryId: string, name: string): Promise<Category> {
    await this.purge();
    const clean = requireName(name, "name");
    return this.store.update((draft) => {
      const category = draft.categories.find((candidate) => candidate.id === categoryId);
      if (!category) throw new NotFoundError("category", categoryId);
      category.name = clean; // Renaming changes nothing on Google (phase 5+).
      return category;
    });
  }

  async renameSubcategory(categoryId: string, subcategoryId: string, name: string): Promise<Subcategory> {
    await this.purge();
    const clean = requireName(name, "subcategory name");
    return this.store.update((draft) => {
      const category = draft.categories.find((candidate) => candidate.id === categoryId);
      if (!category) throw new NotFoundError("category", categoryId);
      const subcategory = category.subcategories.find((candidate) => candidate.id === subcategoryId);
      if (!subcategory) throw new NotFoundError("subcategory", subcategoryId);
      subcategory.name = clean;
      return subcategory;
    });
  }

  /** Deletes a subcategory. Blocked while items use it — the caller must move them first (see move-before-delete). */
  async deleteSubcategory(categoryId: string, subcategoryId: string): Promise<void> {
    await this.purge();
    await this.store.update((draft) => {
      const category = draft.categories.find((candidate) => candidate.id === categoryId);
      if (!category) throw new NotFoundError("category", categoryId);
      if (!category.subcategories.some((candidate) => candidate.id === subcategoryId)) throw new NotFoundError("subcategory", subcategoryId);
      const count = draft.items.filter((item) => item.categoryId === categoryId && item.subcategoryId === subcategoryId).length;
      if (count > 0) throw new ValidationError(`Cannot delete the subcategory: ${count} item(s) use it. Move them first.`);
      category.subcategories = category.subcategories.filter((candidate) => candidate.id !== subcategoryId);
    });
  }

  /** Moves items out of a subcategory to a target (category/subcategory, or Unfiled = null), then deletes it. Links kept. */
  async moveItemsAndDeleteSubcategory(categoryId: string, subcategoryId: string, to: { categoryId: string | null; subcategoryId?: string | null }): Promise<{ moved: number }> {
    await this.purge();
    return this.store.update((draft) => {
      const category = draft.categories.find((candidate) => candidate.id === categoryId);
      if (!category) throw new NotFoundError("category", categoryId);
      if (!category.subcategories.some((candidate) => candidate.id === subcategoryId)) throw new NotFoundError("subcategory", subcategoryId);
      const target = to.categoryId === null ? null : draft.categories.find((candidate) => candidate.id === to.categoryId);
      if (to.categoryId !== null && !target) throw new NotFoundError("category", to.categoryId);
      const subId = resolveSubcategory(target ?? null, to.subcategoryId ?? null);
      let moved = 0;
      for (const item of draft.items) {
        if (item.categoryId !== categoryId || item.subcategoryId !== subcategoryId) continue;
        item.categoryId = to.categoryId;
        item.subcategoryId = subId;
        item.updated = this.now();
        moved += 1;
      }
      category.subcategories = category.subcategories.filter((candidate) => candidate.id !== subcategoryId);
      return { moved };
    });
  }

  /** Sets a category's default reminder lead times (whole days). Applied to Events; Deadlines carry none. */
  async setCategoryLeadTimes(categoryId: string, leadTimes: number[]): Promise<Category> {
    await this.purge();
    const clean = requireWholeDays(leadTimes, "defaultLeadTimes");
    return this.store.update((draft) => {
      const category = draft.categories.find((candidate) => candidate.id === categoryId);
      if (!category) throw new NotFoundError("category", categoryId);
      category.defaultLeadTimes = clean;
      return category;
    });
  }

  /** Sets a category's Google event colour id (phase 5). null clears it (Google default). Nothing is pushed here. */
  async setCategoryColour(categoryId: string, colour: string | null): Promise<Category> {
    await this.purge();
    return this.store.update((draft) => {
      const category = draft.categories.find((candidate) => candidate.id === categoryId);
      if (!category) throw new NotFoundError("category", categoryId);
      category.colour = colour;
      return category;
    });
  }

  async deleteCategory(categoryId: string): Promise<void> {
    await this.purge();
    await this.store.update((draft) => {
      const category = draft.categories.find((candidate) => candidate.id === categoryId);
      if (!category) throw new NotFoundError("category", categoryId);
      const count = draft.items.filter((item) => item.categoryId === categoryId).length;
      if (count > 0) throw new ValidationError(`Cannot delete ${category.name}: ${count} item(s) use it. Move them first.`);
      draft.categories = draft.categories.filter((candidate) => candidate.id !== categoryId);
    });
  }

  /** Moves every item out of `fromId` to the chosen category/subcategory, then deletes the now-empty category. */
  async moveItemsAndDeleteCategory(fromId: string, to: { categoryId: string | null; subcategoryId?: string | null }): Promise<{ moved: number }> {
    await this.purge();
    return this.store.update((draft) => {
      const from = draft.categories.find((candidate) => candidate.id === fromId);
      if (!from) throw new NotFoundError("category", fromId);
      const target = to.categoryId === null ? null : draft.categories.find((candidate) => candidate.id === to.categoryId);
      if (to.categoryId !== null && !target) throw new NotFoundError("category", to.categoryId);
      const subId = resolveSubcategory(target ?? null, to.subcategoryId ?? null);
      let moved = 0;
      for (const item of draft.items) {
        if (item.categoryId !== fromId) continue;
        item.categoryId = to.categoryId;
        item.subcategoryId = subId;
        item.updated = this.now();
        moved += 1;
      }
      draft.categories = draft.categories.filter((candidate) => candidate.id !== fromId);
      return { moved };
    });
  }

  /** Items with no category, and the count — the "No category (n)" group. */
  async noCategory(): Promise<{ count: number; items: Item[] }> {
    await this.purge();
    const items = (await this.store.read()).items.filter((item) => item.categoryId === null);
    return { count: items.length, items };
  }

  // ---- Items --------------------------------------------------------------

  async listItems(query: { kind?: ItemKind; categoryId?: string | null; status?: "open" | "done" } = {}): Promise<Item[]> {
    await this.purge();
    const items = (await this.store.read()).items;
    return items.filter((item) =>
      (query.kind === undefined || item.kind === query.kind) &&
      (query.categoryId === undefined || item.categoryId === query.categoryId) &&
      (query.status === undefined || item.status === query.status));
  }

  async getItem(id: string): Promise<Item> {
    await this.purge();
    const item = (await this.store.read()).items.find((candidate) => candidate.id === id);
    if (!item) throw new NotFoundError("item", id);
    return item;
  }

  async createItem(input: ItemInput): Promise<Item> {
    await this.purge();
    if (!(itemKinds as readonly string[]).includes(input.kind)) throw new ValidationError("kind must be task or reminder");
    const title = requireName(input.title, "title");
    if (!isIso(input.date)) throw new ValidationError("date must be YYYY-MM-DD");
    const allDay = input.allDay ?? false;
    if (allDay && input.time != null) throw new ValidationError("an all-day item has no time");
    if (!allDay && input.time != null && !timePattern.test(input.time)) throw new ValidationError("time must be HH:MM");
    const priority = input.priority ?? "normal";
    if (!(priorities as readonly string[]).includes(priority)) throw new ValidationError("priority must be low, normal or high");
    const recurrence = buildRecurrence(input.recurrence, input.date);
    const document = await this.store.read();
    const categoryId = input.categoryId ?? null;
    const category = categoryId === null ? null : document.categories.find((candidate) => candidate.id === categoryId);
    if (categoryId !== null && !category) throw new NotFoundError("category", categoryId);
    const subcategoryId = resolveSubcategory(category ?? null, input.subcategoryId ?? null);
    const timestamp = this.now();
    const item: Item = {
      id: randomUUID(), kind: input.kind, title, categoryId, subcategoryId,
      allDay, date: input.date, time: allDay ? null : input.time ?? null, timeZone: input.timeZone ?? document.settings.timeZone,
      dueDate: input.dueDate ?? null, plannedDate: input.plannedDate ?? null,
      priority, status: "open", recurrence, leadTimes: input.leadTimes ?? null, snoozedUntil: null,
      created: timestamp, updated: timestamp
    };
    return this.store.update((draft) => { draft.items.push(item); return item; });
  }

  /** Updates an item. Changing the category clears the subcategory unless a valid one for the new category is given. */
  async updateItem(id: string, patch: Partial<ItemInput>): Promise<Item> {
    await this.purge();
    return this.store.update((draft) => {
      const item = draft.items.find((candidate) => candidate.id === id);
      if (!item) throw new NotFoundError("item", id);
      if (patch.title !== undefined) item.title = requireName(patch.title, "title");
      if (patch.date !== undefined) { if (!isIso(patch.date)) throw new ValidationError("date must be YYYY-MM-DD"); item.date = patch.date; }
      if (patch.dueDate !== undefined) item.dueDate = patch.dueDate;
      if (patch.plannedDate !== undefined) item.plannedDate = patch.plannedDate;
      if (patch.priority !== undefined) { if (!(priorities as readonly string[]).includes(patch.priority)) throw new ValidationError("priority must be low, normal or high"); item.priority = patch.priority; }
      if (patch.leadTimes !== undefined) item.leadTimes = patch.leadTimes === null ? null : requireWholeDays(patch.leadTimes, "leadTimes");
      if (patch.allDay !== undefined) { item.allDay = patch.allDay; if (patch.allDay) item.time = null; }
      if (patch.time !== undefined) { if (item.allDay && patch.time != null) throw new ValidationError("an all-day item has no time"); if (patch.time != null && !timePattern.test(patch.time)) throw new ValidationError("time must be HH:MM"); item.time = patch.time ?? null; }
      if (patch.timeZone !== undefined) item.timeZone = patch.timeZone;
      if (patch.recurrence !== undefined) item.recurrence = buildRecurrence(patch.recurrence, item.date);

      const categoryChanging = patch.categoryId !== undefined && patch.categoryId !== item.categoryId;
      if (patch.categoryId !== undefined) {
        const next = patch.categoryId === null ? null : draft.categories.find((candidate) => candidate.id === patch.categoryId);
        if (patch.categoryId !== null && !next) throw new NotFoundError("category", patch.categoryId);
        item.categoryId = patch.categoryId;
        if (categoryChanging) item.subcategoryId = null; // Changing category clears the subcategory.
      }
      if (patch.subcategoryId !== undefined) {
        const category = item.categoryId === null ? null : draft.categories.find((candidate) => candidate.id === item.categoryId);
        item.subcategoryId = resolveSubcategory(category ?? null, patch.subcategoryId);
      }
      item.updated = this.now();
      return item;
    });
  }

  // ---- Complete, delete, restore, undo ------------------------------------

  /** Records a completion for one occurrence. A non-recurring task also becomes done; a recurring series stays open. */
  async completeItem(id: string, occurrenceDate?: IsoDate): Promise<void> {
    await this.purge();
    const before = await this.store.read();
    const timestamp = this.now();
    await this.store.update((draft) => {
      const item = draft.items.find((candidate) => candidate.id === id);
      if (!item) throw new NotFoundError("item", id);
      const occurrence = occurrenceDate ?? item.date;
      draft.doneLog.push({ id: randomUUID(), itemId: id, occurrenceDate: occurrence, completedAt: timestamp });
      if (!item.recurrence) { item.status = "done"; item.updated = timestamp; }
    });
    this.rememberUndo("complete", before);
  }

  /** Un-ticks a completed deadline: status back to open and its done-log cleared. Works whatever the due date. */
  async reopenItem(id: string): Promise<void> {
    await this.purge();
    const before = await this.store.read();
    const timestamp = this.now();
    await this.store.update((draft) => {
      const item = draft.items.find((candidate) => candidate.id === id);
      if (!item) throw new NotFoundError("item", id);
      if (!item.recurrence) { item.status = "open"; item.updated = timestamp; }
      draft.doneLog = draft.doneLog.filter((entry) => entry.itemId !== id);
    });
    this.rememberUndo("complete", before);
  }

  async deleteItem(id: string, options: { scope?: DeleteScope; occurrenceDate?: IsoDate } = {}): Promise<void> {
    await this.purge();
    const before = await this.store.read();
    const nowMs = this.clock().getTime();
    const timestamp = this.now();
    const trashDays = before.settings.trashDays;
    await this.store.update((draft) => {
      const item = draft.items.find((candidate) => candidate.id === id);
      if (!item) throw new NotFoundError("item", id);
      const toTrash = (snapshot: Item, reason: TrashEntry["reason"]): void => {
        draft.trash.push({ id: randomUUID(), item: structuredClone(snapshot), deletedAt: timestamp, expiresAt: new Date(nowMs + trashDays * 86_400_000).toISOString(), reason });
      };
      if (!item.recurrence) { toTrash(item, "app"); draft.items = draft.items.filter((candidate) => candidate.id !== id); return; }

      const scope = options.scope;
      if (!scope) throw new ValidationError("a recurring item needs a delete scope: occurrence, future or series");
      if (scope === "occurrence") {
        if (!options.occurrenceDate) throw new ValidationError("deleting one occurrence needs occurrenceDate");
        if (!item.recurrence.skips.includes(options.occurrenceDate)) item.recurrence.skips.push(options.occurrenceDate);
        item.updated = timestamp; // No trash entry for a single occurrence.
        return;
      }
      if (scope === "future") {
        if (!options.occurrenceDate) throw new ValidationError("deleting this and all future needs occurrenceDate");
        const tail: Item = structuredClone(item);
        tail.id = randomUUID();
        tail.recurrence = { ...item.recurrence, anchor: options.occurrenceDate };
        toTrash(tail, "series");
        item.recurrence.until = addDays(options.occurrenceDate, -1); // End the live series the day before.
        item.updated = timestamp;
        return;
      }
      toTrash(item, "series"); // entire series
      draft.items = draft.items.filter((candidate) => candidate.id !== id);
    });
    this.rememberUndo("delete", before);
  }

  async listTrash(): Promise<TrashEntry[]> {
    await this.purge();
    return (await this.store.read()).trash;
  }

  /** Public purge for the startup/timer sweep (local only; never touches Google). */
  async purgeExpired(): Promise<void> {
    await this.purge();
  }

  /** Adds a snapshot to the Deleted list directly (used for conflict losers and Google-side deletes). */
  async trashItem(snapshot: Item, reason: TrashEntry["reason"]): Promise<TrashEntry> {
    await this.purge();
    const nowMs = this.clock().getTime();
    const timestamp = this.now();
    return this.store.update((draft) => {
      const entry: TrashEntry = { id: randomUUID(), item: structuredClone(snapshot), deletedAt: timestamp, expiresAt: new Date(nowMs + draft.settings.trashDays * 86_400_000).toISOString(), reason };
      draft.trash.push(entry);
      return entry;
    });
  }

  /** "Delete now": removes one trash entry immediately. The linked Google event is removed on the next sync. */
  async deleteNow(trashId: string): Promise<void> {
    await this.purge();
    await this.store.update((draft) => {
      if (!draft.trash.some((entry) => entry.id === trashId)) throw new NotFoundError("trash entry", trashId);
      draft.trash = draft.trash.filter((entry) => entry.id !== trashId);
    });
  }

  /** Restores a trashed item: removes the trash entry and puts the item back. */
  async restore(trashId: string): Promise<Item> {
    await this.purge();
    return this.store.update((draft) => {
      const entry = draft.trash.find((candidate) => candidate.id === trashId);
      if (!entry) throw new NotFoundError("trash entry", trashId);
      draft.trash = draft.trash.filter((candidate) => candidate.id !== trashId);
      const restored = structuredClone(entry.item);
      if (!draft.items.some((candidate) => candidate.id === restored.id)) draft.items.push(restored);
      return restored;
    });
  }

  /** Reverses the last delete or complete, within 10 seconds, from memory only. */
  async undo(): Promise<boolean> {
    const state = this.undo_;
    if (!state || this.clock().getTime() > state.expiresAt) { this.undo_ = null; return false; }
    await this.store.update((draft) => {
      draft.items = structuredClone(state.items);
      draft.trash = structuredClone(state.trash);
      draft.doneLog = structuredClone(state.doneLog);
    });
    this.undo_ = null;
    return true;
  }

  // ---- Snooze, reminders, today -------------------------------------------

  async snooze(id: string, until: string): Promise<Item> {
    await this.purge();
    if (Number.isNaN(Date.parse(until))) throw new ValidationError("snooze until must be a timestamp");
    return this.store.update((draft) => {
      const item = draft.items.find((candidate) => candidate.id === id);
      if (!item) throw new NotFoundError("item", id);
      item.snoozedUntil = until;
      item.updated = this.now();
      return item;
    });
  }

  /** Reminder times for every occurrence in the range, excluding items snoozed past "now". */
  async remindersInRange(rangeStart: IsoDate, rangeEnd: IsoDate): Promise<ReminderTime[]> {
    await this.purge();
    const document = await this.store.read();
    const nowMs = this.clock().getTime();
    const categories = new Map(document.categories.map((category) => [category.id, category]));
    const out: ReminderTime[] = [];
    for (const item of document.items) {
      if (item.snoozedUntil && Date.parse(item.snoozedUntil) > nowMs) continue;
      const category = item.categoryId === null ? null : categories.get(item.categoryId) ?? null;
      for (const occurrence of occurrences(item, rangeStart, rangeEnd)) {
        out.push(...reminderTimes(item, category, occurrence, document.settings.allDayReminderTime));
      }
    }
    return out.sort((left, right) => `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`));
  }

  /** Today's tasks: open tasks due or planned on or before today, with carry-over ones flagged overdue. */
  async today(): Promise<{ item: Item; overdue: boolean }[]> {
    await this.purge();
    const today = this.todayDate();
    const items = (await this.store.read()).items;
    return items
      .filter((item) => item.kind === "task" && item.status === "open")
      .map((item) => ({ item, reference: item.dueDate ?? item.plannedDate ?? item.date }))
      .filter((entry) => entry.reference <= today)
      .map((entry) => ({ item: entry.item, overdue: entry.reference < today }));
  }
}

// ---- helpers --------------------------------------------------------------

function requireName(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new ValidationError(`${field} must be a non-empty string`);
  return value.trim();
}

function requireWholeDays(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be a list of whole days`);
  return value.map((entry) => {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) throw new ValidationError(`${field} must be whole days of 0 or more`);
    return entry;
  });
}

function isIso(value: unknown): value is IsoDate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Validates a chosen subcategory belongs to the category; a null category forces a null subcategory. */
function resolveSubcategory(category: Category | null, subcategoryId: string | null): string | null {
  if (subcategoryId === null || subcategoryId === undefined) return null;
  if (!category) throw new ValidationError("an item with no category cannot have a subcategory");
  if (!category.subcategories.some((sub) => sub.id === subcategoryId)) throw new ValidationError("subcategory does not belong to the category");
  return subcategoryId;
}

function buildRecurrence(input: { freq: RecurrenceFreq; anchor?: IsoDate } | null | undefined, date: IsoDate): Recurrence | null {
  if (input === null || input === undefined) return null;
  if (!(recurrenceFreqs as readonly string[]).includes(input.freq)) throw new ValidationError("recurrence freq must be weekly, monthly or yearly");
  const anchor = input.anchor ?? date;
  if (!isIso(anchor)) throw new ValidationError("recurrence anchor must be YYYY-MM-DD");
  return { freq: input.freq, anchor, until: null, skips: [] };
}
