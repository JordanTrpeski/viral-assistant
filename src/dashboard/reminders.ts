import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NotFoundError, ValidationError } from "./errors.js";
import { colourCategories, type ColourCategory } from "./shared/colours.js";
import { addDays, type IsoDate } from "./shared/dates.js";
import { JsonDocumentStore, type StoreFileSystem } from "./store.js";
import { defaultPrepareDays, type TimelineItem } from "./timeline.js";
import { isObject, rejectUnknownFields, requireDate, requireObject, requireOneOf, requireText } from "./validation.js";

export interface Reminder {
  id: string;
  title: string;
  date: IsoDate;
  category: ColourCategory;
  /** Date to start preparing; personal dates default to 14 days before. Null means no prepare-by. */
  prepareBy: IsoDate | null;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RemindersDocument {
  schemaVersion: 1;
  reminders: Reminder[];
}

export const reminderStatuses = ["open", "done", "all"] as const;
export type ReminderStatus = typeof reminderStatuses[number];

export function emptyRemindersDocument(): RemindersDocument {
  return { schemaVersion: 1, reminders: [] };
}

export function defaultPrepareBy(date: IsoDate): IsoDate {
  return addDays(date, -defaultPrepareDays);
}

function validateRemindersDocument(value: unknown): RemindersDocument {
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.reminders)) throw new Error("reminders data must be an object with schemaVersion 1 and a reminders array");
  return {
    schemaVersion: 1,
    reminders: value.reminders.map((raw, index) => {
      if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.done !== "boolean" || typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") {
        throw new Error(`reminders[${index}] is malformed`);
      }
      return {
        id: raw.id, title: requireText(raw.title, `reminders[${index}].title`), date: requireDate(raw.date, `reminders[${index}].date`),
        category: requireOneOf(raw.category, colourCategories, `reminders[${index}].category`),
        prepareBy: raw.prepareBy === null ? null : requireDate(raw.prepareBy, `reminders[${index}].prepareBy`),
        done: raw.done, createdAt: raw.createdAt, updatedAt: raw.updatedAt
      };
    })
  };
}

function checkPrepareBy(prepareBy: IsoDate | null, date: IsoDate): void {
  if (prepareBy !== null && prepareBy > date) throw new ValidationError("prepareBy must be on or before the reminder date");
}

function find(document: RemindersDocument, id: string): Reminder {
  const reminder = document.reminders.find((candidate) => candidate.id === id);
  if (!reminder) throw new NotFoundError("reminder", id);
  return reminder;
}

/** Reminders as timeline items in their own colour; prepare-by entries are derived from `prepareBy` separately. */
export function reminderTimelineItems(reminders: Reminder[]): TimelineItem[] {
  return reminders.map((reminder) => ({
    id: `reminder:${reminder.id}`,
    date: reminder.date,
    source: "reminder",
    sourceId: reminder.id,
    label: reminder.title,
    colour: reminder.category,
    status: reminder.done ? "done" : "scheduled",
    amountCents: null,
    prepareBy: reminder.prepareBy
  }));
}

export interface RemindersServiceOptions {
  clock?: () => Date;
  fs?: StoreFileSystem;
}

/** Owns `.viral/dashboard/reminders.json`. */
export class RemindersService {
  private readonly clock: () => Date;

  constructor(readonly store: JsonDocumentStore<RemindersDocument>, clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  static open(directory: string, options: RemindersServiceOptions = {}): RemindersService {
    return new RemindersService(new JsonDocumentStore(join(directory, "reminders.json"), validateRemindersDocument, emptyRemindersDocument, options.fs), options.clock);
  }

  async list(status: ReminderStatus = "all"): Promise<Reminder[]> {
    const filter = requireOneOf(status, reminderStatuses, "status");
    return (await this.store.read()).reminders
      .filter((reminder) => filter === "all" || (filter === "done") === reminder.done)
      .sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
  }

  async get(id: string): Promise<Reminder> {
    return find(await this.store.read(), id);
  }

  /** Personal reminders get prepare-by 14 days before unless `prepareBy` is given (a date, or null for none). */
  async create(body: unknown): Promise<Reminder> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["title", "date", "category", "prepareBy"]);
    const title = requireText(input.title, "title", 200);
    const date = requireDate(input.date);
    const category = input.category === undefined ? "reminder" : requireOneOf(input.category, colourCategories, "category");
    const prepareBy = input.prepareBy === undefined ? (category === "personal" ? defaultPrepareBy(date) : null)
      : input.prepareBy === null ? null : requireDate(input.prepareBy, "prepareBy");
    checkPrepareBy(prepareBy, date);
    const timestamp = this.clock().toISOString();
    return this.store.update((document) => {
      const reminder: Reminder = { id: randomUUID(), title, date, category, prepareBy, done: false, createdAt: timestamp, updatedAt: timestamp };
      document.reminders.push(reminder);
      return reminder;
    });
  }

  /**
   * Edits any field. Moving the date keeps a default prepare-by (14 days before) in step; a custom prepare-by
   * stays put and must still fall on or before the new date. Switching to Personal adds the default if none is set.
   */
  async update(id: string, body: unknown): Promise<Reminder> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["title", "date", "category", "prepareBy", "done"]);
    const title = input.title === undefined ? undefined : requireText(input.title, "title", 200);
    const date = input.date === undefined ? undefined : requireDate(input.date);
    const category = input.category === undefined ? undefined : requireOneOf(input.category, colourCategories, "category");
    const prepareBy = input.prepareBy === undefined ? undefined : input.prepareBy === null ? null : requireDate(input.prepareBy, "prepareBy");
    if (input.done !== undefined && typeof input.done !== "boolean") throw new ValidationError("done must be true or false");
    return this.store.update((document) => {
      const reminder = find(document, id);
      const followsDefault = reminder.prepareBy !== null && reminder.prepareBy === defaultPrepareBy(reminder.date);
      if (title !== undefined) reminder.title = title;
      if (date !== undefined) {
        reminder.date = date;
        if (prepareBy === undefined && followsDefault) reminder.prepareBy = defaultPrepareBy(date);
      }
      if (category !== undefined) {
        if (category === "personal" && reminder.category !== "personal" && reminder.prepareBy === null && prepareBy === undefined) reminder.prepareBy = defaultPrepareBy(reminder.date);
        reminder.category = category;
      }
      if (prepareBy !== undefined) reminder.prepareBy = prepareBy;
      if (typeof input.done === "boolean") reminder.done = input.done;
      checkPrepareBy(reminder.prepareBy, reminder.date);
      reminder.updatedAt = this.clock().toISOString();
      return reminder;
    });
  }

  async delete(id: string): Promise<void> {
    await this.store.update((document) => {
      find(document, id);
      document.reminders = document.reminders.filter((reminder) => reminder.id !== id);
    });
  }
}
