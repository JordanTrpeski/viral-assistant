// Calendar v2 data model (phase 1). Pure types, validation and the empty document. No Google, no routes, no
// screens — see docs/design/calendar-v2.md and docs/build/phases.md. Stored at .viral/calendar/store.json.
import { isIsoDate, type IsoDate } from "../shared/dates.js";
import { isObject } from "../validation.js";

export type ItemKind = "task" | "reminder";
export type Priority = "low" | "normal" | "high";
export type ItemStatus = "open" | "done";
export type RecurrenceFreq = "weekly" | "monthly" | "yearly";
export type TrashReason = "app" | "series" | "conflict";

export const itemKinds: readonly ItemKind[] = ["task", "reminder"];
export const priorities: readonly Priority[] = ["low", "normal", "high"];
export const itemStatuses: readonly ItemStatus[] = ["open", "done"];
export const recurrenceFreqs: readonly RecurrenceFreq[] = ["weekly", "monthly", "yearly"];
export const trashReasons: readonly TrashReason[] = ["app", "series", "conflict"];

export interface Subcategory {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  /** Google event colour; null until phase 5 wires the palette. The app owns this value. */
  colour: string | null;
  subcategories: Subcategory[];
  /** Default reminder lead times in whole days; may be empty. */
  defaultLeadTimes: number[];
  created: string;
}

export interface Recurrence {
  freq: RecurrenceFreq;
  /** The series start date; occurrences are generated from here. */
  anchor: IsoDate;
  /** Inclusive last date the series runs to, or null for open-ended. Set by "this and all future" deletes. */
  until: IsoDate | null;
  /** Occurrence dates removed by a "this occurrence" delete. */
  skips: IsoDate[];
}

export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  categoryId: string | null;
  subcategoryId: string | null;
  allDay: boolean;
  date: IsoDate;
  /** HH:MM for timed items; null when all-day. */
  time: string | null;
  /** IANA zone name (e.g. "Europe/Dublin"). */
  timeZone: string;
  dueDate: IsoDate | null;
  plannedDate: IsoDate | null;
  priority: Priority;
  status: ItemStatus;
  recurrence: Recurrence | null;
  /** null inherits the category default; a list (possibly empty) overrides it and never adds to it. */
  leadTimes: number[] | null;
  /** When set, reminder queries skip this item until this instant. */
  snoozedUntil: string | null;
  created: string;
  updated: string;
}

export interface DoneLogEntry {
  id: string;
  itemId: string;
  occurrenceDate: IsoDate;
  completedAt: string;
}

export interface TrashEntry {
  id: string;
  item: Item;
  deletedAt: string;
  expiresAt: string;
  reason: TrashReason;
}

export interface Settings {
  trashDays: number;
  allDayReminderTime: string;
  /** Default IANA zone for new items; each item still keeps its own zone. */
  timeZone: string;
}

export const defaultTimeZone = "Europe/Ljubljana";

/** The seven default categories from the decisions file. A fixed dropdown in phase 4; management arrives in phase 7. */
export const defaultCategoryNames = ["Study", "Work", "Admin", "Home", "Health", "People", "Personal"] as const;

export interface DefaultCategory {
  name: string;
  subcategories: string[];
  /** Default reminder lead times in whole days, applied to Events (phase 7). */
  defaultLeadTimes: number[];
}

/**
 * Phase 7 seed: the seven default categories with their initial subcategories and default lead times. Seeded only
 * on a fresh store (no categories yet); existing categories are never changed. The user edits these freely.
 */
export const defaultCategories: DefaultCategory[] = [
  { name: "Study", subcategories: ["Exams", "Coursework", "Reading"], defaultLeadTimes: [1] },
  { name: "Work", subcategories: ["Meetings", "Deadlines", "Admin"], defaultLeadTimes: [1] },
  { name: "Admin", subcategories: ["Bills", "Appointments", "Renewals"], defaultLeadTimes: [1, 7] },
  { name: "Home", subcategories: ["Chores", "Maintenance", "Shopping"], defaultLeadTimes: [1] },
  { name: "Health", subcategories: ["Appointments", "Medication", "Fitness"], defaultLeadTimes: [1] },
  { name: "People", subcategories: ["Family", "Friends", "Birthdays"], defaultLeadTimes: [1, 7] },
  { name: "Personal", subcategories: ["Hobbies", "Travel", "Finance"], defaultLeadTimes: [1] }
];

export interface CalendarDocument {
  schemaVersion: 1;
  categories: Category[];
  items: Item[];
  doneLog: DoneLogEntry[];
  trash: TrashEntry[];
  settings: Settings;
  /** Ids of one-off migrations already applied (e.g. "organise-v1"), so each runs at most once. */
  migrations: string[];
}

export function emptyCalendarDocument(): CalendarDocument {
  return { schemaVersion: 1, categories: [], items: [], doneLog: [], trash: [], settings: { trashDays: 7, allDayReminderTime: "09:00", timeZone: defaultTimeZone }, migrations: [] };
}

const timePattern = /^\d{2}:\d{2}$/;

function str(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where} must be a string`);
  return value;
}

function isoOrNull(value: unknown, where: string): IsoDate | null {
  if (value === null || value === undefined) return null;
  if (!isIsoDate(value)) throw new Error(`${where} must be YYYY-MM-DD or null`);
  return value;
}

function wholeDays(value: unknown, where: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array of whole days`);
  return value.map((entry, index) => {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) throw new Error(`${where}[${index}] must be a whole day of 0 or more`);
    return entry;
  });
}

function validateSubcategory(value: unknown, where: string): Subcategory {
  if (!isObject(value)) throw new Error(`${where} must be an object`);
  return { id: str(value.id, `${where}.id`), name: str(value.name, `${where}.name`) };
}

function validateCategory(value: unknown, index: number): Category {
  if (!isObject(value)) throw new Error(`categories[${index}] must be an object`);
  return {
    id: str(value.id, `categories[${index}].id`),
    name: str(value.name, `categories[${index}].name`),
    colour: value.colour === null || value.colour === undefined ? null : str(value.colour, `categories[${index}].colour`),
    subcategories: (Array.isArray(value.subcategories) ? value.subcategories : []).map((sub, subIndex) => validateSubcategory(sub, `categories[${index}].subcategories[${subIndex}]`)),
    defaultLeadTimes: wholeDays(value.defaultLeadTimes ?? [], `categories[${index}].defaultLeadTimes`),
    created: str(value.created, `categories[${index}].created`)
  };
}

function validateRecurrence(value: unknown, where: string): Recurrence | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) throw new Error(`${where} must be an object or null`);
  if (!(recurrenceFreqs as readonly string[]).includes(String(value.freq))) throw new Error(`${where}.freq must be weekly, monthly or yearly`);
  if (!isIsoDate(value.anchor)) throw new Error(`${where}.anchor must be YYYY-MM-DD`);
  return {
    freq: value.freq as RecurrenceFreq,
    anchor: value.anchor,
    until: isoOrNull(value.until, `${where}.until`),
    skips: (Array.isArray(value.skips) ? value.skips : []).map((skip, skipIndex) => {
      if (!isIsoDate(skip)) throw new Error(`${where}.skips[${skipIndex}] must be YYYY-MM-DD`);
      return skip;
    })
  };
}

function validateItem(value: unknown, index: number): Item {
  if (!isObject(value)) throw new Error(`items[${index}] must be an object`);
  const where = `items[${index}]`;
  if (!(itemKinds as readonly string[]).includes(String(value.kind))) throw new Error(`${where}.kind must be task or reminder`);
  if (!isIsoDate(value.date)) throw new Error(`${where}.date must be YYYY-MM-DD`);
  if (typeof value.allDay !== "boolean") throw new Error(`${where}.allDay must be a boolean`);
  const time = value.time === null || value.time === undefined ? null : str(value.time, `${where}.time`);
  if (time !== null && !timePattern.test(time)) throw new Error(`${where}.time must be HH:MM or null`);
  if (!(priorities as readonly string[]).includes(String(value.priority))) throw new Error(`${where}.priority must be low, normal or high`);
  if (!(itemStatuses as readonly string[]).includes(String(value.status))) throw new Error(`${where}.status must be open or done`);
  return {
    id: str(value.id, `${where}.id`),
    kind: value.kind as ItemKind,
    title: str(value.title, `${where}.title`),
    categoryId: value.categoryId === null || value.categoryId === undefined ? null : str(value.categoryId, `${where}.categoryId`),
    subcategoryId: value.subcategoryId === null || value.subcategoryId === undefined ? null : str(value.subcategoryId, `${where}.subcategoryId`),
    allDay: value.allDay,
    date: value.date,
    time,
    timeZone: str(value.timeZone, `${where}.timeZone`),
    dueDate: isoOrNull(value.dueDate, `${where}.dueDate`),
    plannedDate: isoOrNull(value.plannedDate, `${where}.plannedDate`),
    priority: value.priority as Priority,
    status: value.status as ItemStatus,
    recurrence: validateRecurrence(value.recurrence, `${where}.recurrence`),
    leadTimes: value.leadTimes === null || value.leadTimes === undefined ? null : wholeDays(value.leadTimes, `${where}.leadTimes`),
    snoozedUntil: value.snoozedUntil === null || value.snoozedUntil === undefined ? null : str(value.snoozedUntil, `${where}.snoozedUntil`),
    created: str(value.created, `${where}.created`),
    updated: str(value.updated, `${where}.updated`)
  };
}

function validateDoneLog(value: unknown, index: number): DoneLogEntry {
  if (!isObject(value)) throw new Error(`doneLog[${index}] must be an object`);
  if (!isIsoDate(value.occurrenceDate)) throw new Error(`doneLog[${index}].occurrenceDate must be YYYY-MM-DD`);
  return {
    id: str(value.id, `doneLog[${index}].id`),
    itemId: str(value.itemId, `doneLog[${index}].itemId`),
    occurrenceDate: value.occurrenceDate,
    completedAt: str(value.completedAt, `doneLog[${index}].completedAt`)
  };
}

function validateTrash(value: unknown, index: number): TrashEntry {
  if (!isObject(value)) throw new Error(`trash[${index}] must be an object`);
  if (!(trashReasons as readonly string[]).includes(String(value.reason))) throw new Error(`trash[${index}].reason is unknown`);
  return {
    id: str(value.id, `trash[${index}].id`),
    item: validateItem(value.item, index),
    deletedAt: str(value.deletedAt, `trash[${index}].deletedAt`),
    expiresAt: str(value.expiresAt, `trash[${index}].expiresAt`),
    reason: value.reason as TrashReason
  };
}

export function validateCalendarDocument(value: unknown): CalendarDocument {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error("calendar store must be an object with schemaVersion 1");
  const settings = isObject(value.settings) ? value.settings : {};
  return {
    schemaVersion: 1,
    categories: (Array.isArray(value.categories) ? value.categories : []).map(validateCategory),
    items: (Array.isArray(value.items) ? value.items : []).map(validateItem),
    doneLog: (Array.isArray(value.doneLog) ? value.doneLog : []).map(validateDoneLog),
    trash: (Array.isArray(value.trash) ? value.trash : []).map(validateTrash),
    settings: {
      trashDays: typeof settings.trashDays === "number" && Number.isInteger(settings.trashDays) && settings.trashDays > 0 ? settings.trashDays : 7,
      allDayReminderTime: typeof settings.allDayReminderTime === "string" && timePattern.test(settings.allDayReminderTime) ? settings.allDayReminderTime : "09:00",
      timeZone: typeof settings.timeZone === "string" && settings.timeZone.trim() !== "" ? settings.timeZone : defaultTimeZone
    },
    migrations: (Array.isArray(value.migrations) ? value.migrations : []).filter((entry): entry is string => typeof entry === "string")
  };
}
