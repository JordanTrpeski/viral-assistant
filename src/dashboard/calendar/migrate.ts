// Calendar v2 one-off migration (phase 4). Moves the old data into the new calendar store BEFORE the old
// Organise is hidden: old dashboard reminders and old Organise tasks/reminders become new items; everything else
// (notes, lists, projects, trackers, …) is exported to a file but not imported. Runs at most once (recorded in
// the store), is safe to re-run, and renames the source files to *.migrated only after a successful save — never
// deletes them. The planner is pure so tests can check the mapping from fixtures. See docs/design/calendar-v2.md.
import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { localIsoDate, type IsoDate } from "../shared/dates.js";
import { writeJsonAtomic, type JsonDocumentStore, type StoreFileSystem } from "../store.js";
import type { CalendarDocument, Item, ItemStatus, Priority } from "./model.js";

export const ORGANISE_V1 = "organise-v1";
export const DEADLINE_RANGE_V1 = "deadline-range-v1";
const timePattern = /^\d{2}:\d{2}$/;
const PRIORITIES = new Set<Priority>(["low", "normal", "high"]);

export interface MigrationResult {
  /** Whether the migration had already run (recorded in the store) and so did nothing. */
  alreadyDone: boolean;
  reminders: number;
  tasks: number;
  exported: number;
}

export interface MigrationPlan {
  items: Item[];
  exported: unknown[];
  reminders: number;
  tasks: number;
}

interface PlanContext {
  today: IsoDate;
  timeZone: string;
  now: string;
  newId: () => string;
}

function array(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key])) {
    return (value as Record<string, unknown>)[key] as unknown[];
  }
  return [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isoOrNull(value: unknown): IsoDate | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function priorityOf(value: unknown): Priority {
  return typeof value === "string" && PRIORITIES.has(value as Priority) ? value as Priority : "normal";
}

function base(context: PlanContext, kind: Item["kind"], title: string, date: IsoDate, status: ItemStatus): Item {
  return {
    id: context.newId(), kind, title, categoryId: null, subcategoryId: null,
    allDay: true, date, time: null, timeZone: context.timeZone,
    dueDate: null, plannedDate: null, priority: "normal", status,
    recurrence: null, leadTimes: null, snoozedUntil: null, created: context.now, updated: context.now
  };
}

/** Applies an optional HH:MM time from the source record (old data is date-only, but a time is carried if present). */
function withTime(item: Item, rawTime: unknown): Item {
  const time = typeof rawTime === "string" && timePattern.test(rawTime) ? rawTime : null;
  return time ? { ...item, allDay: false, time } : item;
}

/**
 * Pure mapping from the parsed old files to new items plus the exported remainder. "Leave category empty unless
 * it's obvious" — the old categories do not map onto the new seven, so category is always left null here.
 */
export function planMigration(sources: { dashboardReminders: unknown; organiseItems: unknown }, context: PlanContext): MigrationPlan {
  const items: Item[] = [];
  const exported: unknown[] = [];
  let reminders = 0;
  let tasks = 0;

  // Old dashboard reminders (.viral/dashboard/reminders.json): title + date, no category mapping.
  for (const raw of array(sources.dashboardReminders, "reminders")) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const title = str(record.title);
    const date = isoOrNull(record.date);
    if (title === null || date === null) continue;
    const status: ItemStatus = record.done === true ? "done" : "open";
    items.push(withTime(base(context, "reminder", title, date, status), record.time));
    reminders += 1;
  }

  // Old Organise items (.viral/dashboard/organise/items.json): only tasks and reminders become items.
  for (const raw of array(sources.organiseItems, "items")) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const type = str(record.type);
    if (type !== "task" && type !== "reminder") { exported.push(raw); continue; }
    const title = str(record.title);
    if (title === null) { exported.push(raw); continue; }
    const date = isoOrNull(record.date) ?? context.today;
    const status: ItemStatus = str(record.done_at) !== null || record.status === "done" ? "done" : "open";
    if (type === "task") {
      const item = base(context, "task", title, date, status);
      items.push(withTime({ ...item, priority: priorityOf(record.priority) }, record.time));
      tasks += 1;
    } else {
      items.push(withTime(base(context, "reminder", title, date, status), record.time));
      reminders += 1;
    }
  }

  return { items, exported, reminders, tasks };
}

function earliest(dates: (string | null)[]): string | null {
  const present = dates.filter((date): date is string => typeof date === "string" && date !== "");
  return present.length ? present.reduce((a, b) => (a < b ? a : b)) : null;
}

/**
 * Phase 5b: collapse a deadline's old date range to a single due date (its start), and flag an untimed deadline
 * all-day. Mutates the document, bumps `updated` on changed items so they re-sync, and returns how many were
 * touched. Pure apart from the passed `now`.
 */
export function collapseDeadlineRanges(document: CalendarDocument, now: string): number {
  let touched = 0;
  for (const item of document.items) {
    if (item.kind !== "task") continue;
    const start = earliest([item.plannedDate, item.dueDate, item.date]) ?? item.date;
    const nextAllDay = item.time === null ? true : item.allDay;
    if (item.plannedDate === null && item.date === start && item.dueDate === start && item.allDay === nextAllDay) continue;
    item.date = start;
    item.dueDate = start;
    item.plannedDate = null;
    item.allDay = nextAllDay;
    item.updated = now;
    touched += 1;
  }
  return touched;
}

/** Runs {@link collapseDeadlineRanges} once, recorded in the store, safe to re-run. */
export class DeadlineRangeMigration {
  private readonly clock: () => Date;
  constructor(private readonly store: JsonDocumentStore<CalendarDocument>, options: { clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }
  async run(): Promise<{ alreadyDone: boolean; touched: number }> {
    const current = await this.store.read();
    if (current.migrations.includes(DEADLINE_RANGE_V1)) return { alreadyDone: true, touched: 0 };
    const now = this.clock().toISOString();
    let touched = 0;
    await this.store.update((draft) => {
      touched = collapseDeadlineRanges(draft, now);
      if (!draft.migrations.includes(DEADLINE_RANGE_V1)) draft.migrations.push(DEADLINE_RANGE_V1);
    });
    return { alreadyDone: false, touched };
  }
}

export interface MigrationPaths {
  dashboardReminders: string;
  organiseItems: string;
  exported: string;
}

export interface MigrationOptions {
  fs?: StoreFileSystem;
  readFile?: (path: string) => Promise<string>;
  clock?: () => Date;
  newId?: () => string;
}

/** Applies {@link planMigration} to the store and the filesystem, once, idempotently. */
export class OrganiseMigration {
  private readonly fs: StoreFileSystem;
  private readonly readFile: (path: string) => Promise<string>;
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly store: JsonDocumentStore<CalendarDocument>,
    private readonly paths: MigrationPaths,
    options: MigrationOptions = {}
  ) {
    this.fs = options.fs ?? nodeFs;
    this.readFile = options.readFile ?? ((path) => nodeFs.readFile(path, "utf8"));
    this.clock = options.clock ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
  }

  private async readJson(path: string): Promise<unknown> {
    let text: string;
    try { text = await this.readFile(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try { return JSON.parse(text) as unknown; } catch { return null; }
  }

  async run(): Promise<MigrationResult> {
    const current = await this.store.read();
    if (current.migrations.includes(ORGANISE_V1)) return { alreadyDone: true, reminders: 0, tasks: 0, exported: 0 };

    const dashboardReminders = await this.readJson(this.paths.dashboardReminders);
    const organiseItems = await this.readJson(this.paths.organiseItems);
    const now = this.clock();
    const plan = planMigration(
      { dashboardReminders, organiseItems },
      { today: localIsoDate(now), timeZone: current.settings.timeZone, now: now.toISOString(), newId: this.newId }
    );

    // Save the new items and record the migration atomically; only then touch the source files.
    await this.store.update((draft) => {
      draft.items.push(...plan.items);
      if (!draft.migrations.includes(ORGANISE_V1)) draft.migrations.push(ORGANISE_V1);
    });
    await writeJsonAtomic(this.paths.exported, { migratedAt: now.toISOString(), items: plan.exported }, this.fs);

    // Keep the originals — only rename, after the save succeeded.
    for (const path of [this.paths.dashboardReminders, this.paths.organiseItems]) {
      await this.fs.rename(path, `${path}.migrated`).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }

    return { alreadyDone: false, reminders: plan.reminders, tasks: plan.tasks, exported: plan.exported.length };
  }
}
