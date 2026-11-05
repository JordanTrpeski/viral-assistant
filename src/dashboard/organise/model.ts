// The one Organise item model: every task, reminder, note, list item, project and inbox entry is an OrganiseItem.
import { ValidationError } from "../errors.js";
import { isIsoDate, type IsoDate } from "../shared/dates.js";
import { isObject, rejectUnknownFields, type JsonObject } from "../validation.js";

export const itemTypes = ["task", "reminder", "note", "list_item", "project", "inbox"] as const;
export type ItemType = typeof itemTypes[number];

export const reminderCategories = ["Personal", "Bill", "Study", "Work", "Health", "Other"] as const;
export type ReminderCategory = typeof reminderCategories[number];

export const recurrences = ["none", "yearly", "custom"] as const;
export type Recurrence = typeof recurrences[number];

export const priorities = ["low", "normal", "high"] as const;
export type Priority = typeof priorities[number];

/** Statuses by type; list items take theirs from their list, notes and inbox items have none. */
export const typeStatuses: Readonly<Record<Exclude<ItemType, "list_item">, readonly string[] | null>> = {
  task: ["open", "in_progress", "done"],
  reminder: ["open", "done"],
  project: ["active", "paused", "done"],
  note: null,
  inbox: null
};

/** Plural labels for messages. */
export const typePlural: Readonly<Record<ItemType, string>> = {
  task: "tasks", reminder: "reminders", note: "notes", list_item: "list items", project: "projects", inbox: "inbox items"
};

export const maxTitleLength = 200;
export const maxProjectNameLength = 100;
export const maxNotesLength = 5_000;
export const maxChecklistTextLength = 200;

export interface ChecklistEntry {
  id: string;
  text: string;
  done: boolean;
}

export interface OrganiseItem {
  id: string;
  type: ItemType;
  title: string;
  date: IsoDate | null;
  prepare_by: IsoDate | null;
  recurrence: Recurrence | null;
  interval_days: number | null;
  category: ReminderCategory | null;
  project_id: string | null;
  status: string | null;
  priority: Priority | null;
  notes: string;
  links: string[];
  list_id: string | null;
  checklist: ChecklistEntry[] | null;
  /** Internal, yearly reminders only: the series' month-day ("MM-DD"), so a 29 February date survives non-leap years. */
  recurrence_anchor: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

/** What validation may look up: other items (projects, links) and lists (list items). */
export interface ModelContext {
  items: readonly OrganiseItem[];
  listStatuses(listId: string): readonly string[] | undefined;
  newId(): string;
  now(): string;
}

/** Fields a request may set. `type` is only accepted on create; it changes only through inbox sort. */
export const editableFields = ["title", "date", "prepare_by", "prepare_days", "recurrence", "interval_days", "category", "project_id", "status", "priority", "notes", "links", "list_id", "checklist"] as const;

const typeOnlyFields: Readonly<Record<string, ItemType>> = {
  recurrence: "reminder", interval_days: "reminder", category: "reminder", prepare_days: "reminder", priority: "task", checklist: "task", list_id: "list_item"
};

function optionalDate(value: unknown, field: string): IsoDate | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isIsoDate(value)) throw new ValidationError(`${field} must be a valid date in YYYY-MM-DD format`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

/** The status that counts as finished for an item: a type's "done", or a list's last status. */
export function doneStatus(item: Pick<OrganiseItem, "type" | "list_id">, context: Pick<ModelContext, "listStatuses">): string | null {
  if (item.type === "list_item") return item.list_id ? context.listStatuses(item.list_id)?.at(-1) ?? null : null;
  return typeStatuses[item.type] ? "done" : null;
}

export function allowedStatuses(type: ItemType, listId: string | null, context: Pick<ModelContext, "listStatuses">): readonly string[] | null {
  if (type === "list_item") return listId ? context.listStatuses(listId) ?? null : null;
  return typeStatuses[type];
}

function defaultStatus(type: ItemType, listId: string | null, context: ModelContext): string | null {
  return allowedStatuses(type, listId, context)?.[0] ?? null;
}

function checklist(value: unknown, context: ModelContext): ChecklistEntry[] {
  if (!Array.isArray(value)) throw new ValidationError("checklist must be an array of { text, done }");
  return value.map((raw, index) => {
    if (!isObject(raw)) throw new ValidationError(`checklist[${index}] must be an object`);
    rejectUnknownFields(raw, ["id", "text", "done"]);
    if (typeof raw.text !== "string" || raw.text.trim().length < 1 || raw.text.trim().length > maxChecklistTextLength) {
      throw new ValidationError(`checklist[${index}].text must be 1 to ${maxChecklistTextLength} characters`);
    }
    if (raw.done !== undefined && typeof raw.done !== "boolean") throw new ValidationError(`checklist[${index}].done must be true or false`);
    if (raw.id !== undefined && (typeof raw.id !== "string" || raw.id === "")) throw new ValidationError(`checklist[${index}].id must be a string`);
    return { id: typeof raw.id === "string" ? raw.id : context.newId(), text: raw.text.trim(), done: raw.done === true };
  });
}

/**
 * Validates a whole candidate item (an existing item with changes applied, or a new one) and returns it
 * normalised. Every rule of the shared model is checked here, so create, patch and sort cannot disagree.
 */
export function normaliseItem(candidate: JsonObject, previous: OrganiseItem | null, context: ModelContext): OrganiseItem {
  const type = oneOf(candidate.type, itemTypes, "type");
  for (const [field, onlyType] of Object.entries(typeOnlyFields)) {
    const value = candidate[field];
    if (type !== onlyType && value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) {
      throw new ValidationError(`${field} only applies to ${typePlural[onlyType]}, not ${typePlural[type]}`);
    }
  }

  const titleLimit = type === "project" ? maxProjectNameLength : maxTitleLength;
  let rawTitle = typeof candidate.title === "string" ? candidate.title.trim() : candidate.title;
  const notes = candidate.notes === undefined || candidate.notes === null ? "" : candidate.notes;
  if (typeof notes !== "string") throw new ValidationError("notes must be text");
  if (notes.length > maxNotesLength) throw new ValidationError(`notes must be at most ${maxNotesLength} characters`);
  // A note's title is optional: without one, the first line of its text becomes the title.
  if (type === "note" && (rawTitle === undefined || rawTitle === null || rawTitle === "")) {
    rawTitle = notes.trim().split("\n")[0]?.trim().slice(0, maxTitleLength) ?? "";
    if (!rawTitle) throw new ValidationError("A note needs a title or some text");
  }
  if (typeof rawTitle !== "string" || rawTitle.length < 1 || rawTitle.length > titleLimit) {
    throw new ValidationError(`${type === "project" ? "name" : "title"} must be 1 to ${titleLimit} characters`);
  }

  const date = optionalDate(candidate.date, "date");
  const prepareBy = optionalDate(candidate.prepare_by, "prepare_by");
  if (type === "reminder" && date === null) throw new ValidationError("A reminder needs a date");
  if (prepareBy !== null && date !== null && prepareBy > date) throw new ValidationError("prepare_by must be on or before date");
  if (prepareBy !== null && date === null) throw new ValidationError("prepare_by needs a date to prepare for");

  let recurrence: Recurrence | null = null;
  let intervalDays: number | null = null;
  let category: ReminderCategory | null = null;
  if (type === "reminder") {
    recurrence = candidate.recurrence === undefined || candidate.recurrence === null ? "none" : oneOf(candidate.recurrence, recurrences, "recurrence");
    category = candidate.category === undefined || candidate.category === null ? "Other" : oneOf(candidate.category, reminderCategories, "category");
    if (recurrence === "custom") {
      const interval = candidate.interval_days;
      if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1 || interval > 365) {
        throw new ValidationError("interval_days must be a whole number from 1 to 365 for custom recurrence");
      }
      intervalDays = interval;
    } else if (candidate.interval_days !== undefined && candidate.interval_days !== null) {
      throw new ValidationError("interval_days only applies to custom recurrence");
    }
  }

  const priority: Priority | null = type === "task" ? (candidate.priority === undefined || candidate.priority === null ? "normal" : oneOf(candidate.priority, priorities, "priority")) : null;
  const list: ChecklistEntry[] | null = type === "task" ? (candidate.checklist === undefined || candidate.checklist === null ? [] : checklist(candidate.checklist, context)) : null;

  const selfId = previous?.id ?? null;
  let projectId: string | null = null;
  if (candidate.project_id !== undefined && candidate.project_id !== null && candidate.project_id !== "") {
    if (typeof candidate.project_id !== "string") throw new ValidationError("project_id must be a string");
    if (type === "project") throw new ValidationError("A project cannot belong to another project");
    const project = context.items.find((item) => item.id === candidate.project_id);
    if (!project || project.type !== "project") throw new ValidationError(`project_id ${candidate.project_id} is not an existing project`);
    projectId = project.id;
  }

  let listId: string | null = null;
  if (type === "list_item") {
    if (typeof candidate.list_id !== "string" || candidate.list_id === "") throw new ValidationError("A list item needs a list_id");
    if (!context.listStatuses(candidate.list_id)) throw new ValidationError(`list_id ${candidate.list_id} is not an existing list`);
    listId = candidate.list_id;
  }

  const rawLinks = candidate.links === undefined || candidate.links === null ? [] : candidate.links;
  if (!Array.isArray(rawLinks) || rawLinks.some((link) => typeof link !== "string")) throw new ValidationError("links must be an array of item ids");
  const links = [...new Set(rawLinks as string[])];
  for (const link of links) {
    if (link === selfId) throw new ValidationError("An item cannot link to itself");
    if (!context.items.some((item) => item.id === link)) throw new ValidationError(`links: ${link} is not an existing item`);
  }

  const allowed = allowedStatuses(type, listId, context);
  let status: string | null;
  if (allowed === null) {
    if (candidate.status !== undefined && candidate.status !== null) throw new ValidationError(`${typePlural[type]} have no status`);
    status = null;
  } else {
    const wanted = candidate.status === undefined || candidate.status === null ? (previous && previous.type === type && previous.list_id === listId ? previous.status : null) ?? defaultStatus(type, listId, context) : candidate.status;
    status = oneOf(wanted, allowed, "status");
  }

  const now = context.now();
  const finished = doneStatus({ type, list_id: listId }, context);
  const isDone = status !== null && status === finished;
  const wasDone = previous !== null && previous.done_at !== null;
  return {
    id: previous?.id ?? context.newId(),
    type,
    title: rawTitle,
    date,
    prepare_by: prepareBy,
    recurrence,
    interval_days: intervalDays,
    category,
    project_id: projectId,
    status,
    priority,
    notes,
    links,
    list_id: listId,
    checklist: list,
    recurrence_anchor: recurrence === "yearly" && date !== null ? anchorFor(date, candidate.recurrence_anchor) : null,
    created_at: previous?.created_at ?? now,
    updated_at: now,
    // done_at is set when the status becomes done and cleared when it is reopened.
    done_at: isDone ? (wasDone ? previous!.done_at : now) : null
  };
}

/**
 * Keeps an existing anchor while the date is consistent with it (same month-day, or a 28 February standing in for
 * the 29th in a non-leap year); otherwise the anchor is the date's own month-day.
 */
function anchorFor(date: IsoDate, existing: unknown): string {
  const monthDay = date.slice(5);
  if (typeof existing === "string" && (existing === monthDay || (existing === "02-29" && monthDay === "02-28" && !isIsoDate(`${date.slice(0, 4)}-02-29`)))) return existing;
  return monthDay;
}

/** Builds the candidate for a create request (type required). */
export function createCandidate(body: unknown): JsonObject {
  if (!isObject(body)) throw new ValidationError("body must be a JSON object");
  rejectUnknownFields(body, ["type", ...editableFields]);
  return body;
}

/** Applies a patch to an existing item; `type` cannot be changed here (inbox items change type by sorting). */
export function patchCandidate(previous: OrganiseItem, body: unknown): JsonObject {
  if (!isObject(body)) throw new ValidationError("body must be a JSON object");
  rejectUnknownFields(body, ["type", ...editableFields]);
  if (body.type !== undefined && body.type !== previous.type) throw new ValidationError("type cannot be changed by editing; sort an inbox item to change its type");
  const merged: JsonObject = { ...previous };
  for (const [key, value] of Object.entries(body)) merged[key] = value;
  return merged;
}

/** Loose structural check of items.json; each item is re-validated by normaliseItem on its next change. */
export function validateItemsDocument(value: unknown): { schemaVersion: 1; items: OrganiseItem[] } {
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.items)) throw new Error("organise items must be an object with schemaVersion 1 and an items array");
  value.items.forEach((item, index) => {
    if (!isObject(item) || typeof item.id !== "string" || !(itemTypes as readonly string[]).includes(String(item.type)) || typeof item.title !== "string") {
      throw new Error(`items[${index}] is malformed`);
    }
  });
  return value as unknown as { schemaVersion: 1; items: OrganiseItem[] };
}
