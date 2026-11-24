import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emptyCalendarDocument, validateCalendarDocument, type CalendarDocument } from "../src/dashboard/calendar/model.js";
import { OrganiseMigration, planMigration } from "../src/dashboard/calendar/migrate.js";
import { JsonDocumentStore } from "../src/dashboard/store.js";

const CONTEXT = { today: "2026-11-24", timeZone: "Europe/Ljubljana", now: "2026-11-24T00:00:00.000Z", newId: counter() };

function counter(): () => string {
  let n = 0;
  return () => `id-${(n += 1)}`;
}

const dashboardReminders = {
  schemaVersion: 1,
  reminders: [
    { id: "r1", title: "Pay rent", date: "2026-12-01", category: "personal", prepareBy: null, done: false, createdAt: "x", updatedAt: "x" },
    { id: "r2", title: "Call plumber", date: "2026-12-02", time: "08:30", category: "home", prepareBy: null, done: true, createdAt: "x", updatedAt: "x" }
  ]
};
const organiseItems = {
  schemaVersion: 1,
  items: [
    { id: "t1", type: "task", title: "Essay draft", date: "2026-12-05", priority: "high", done_at: null },
    { id: "m1", type: "reminder", title: "Dentist", date: "2026-12-10", time: "09:15" },
    { id: "n1", type: "note", title: "Ideas", notes: "x" },
    { id: "p1", type: "project", title: "House move" }
  ]
};

test("migrate: each old reminder and task keeps its date, and a time when present", () => {
  const plan = planMigration({ dashboardReminders, organiseItems }, { ...CONTEXT, newId: counter() });

  const rent = plan.items.find((item) => item.title === "Pay rent")!;
  assert.deepEqual([rent.kind, rent.date, rent.allDay, rent.time], ["reminder", "2026-12-01", true, null], "date-only reminder becomes an all-day reminder");
  const plumber = plan.items.find((item) => item.title === "Call plumber")!;
  assert.deepEqual([plumber.date, plumber.allDay, plumber.time, plumber.status], ["2026-12-02", false, "08:30", "done"], "a time is carried and done is kept");
  const essay = plan.items.find((item) => item.title === "Essay draft")!;
  assert.deepEqual([essay.kind, essay.date, essay.priority], ["task", "2026-12-05", "high"]);
  const dentist = plan.items.find((item) => item.title === "Dentist")!;
  assert.deepEqual([dentist.kind, dentist.date, dentist.time, dentist.allDay], ["reminder", "2026-12-10", "09:15", false]);

  assert.equal(plan.reminders, 3);
  assert.equal(plan.tasks, 1);
  assert.deepEqual(plan.exported.map((raw) => (raw as { type: string }).type), ["note", "project"]);
});

test("migrate: category is left empty (old categories do not map onto the new seven)", () => {
  const plan = planMigration({ dashboardReminders, organiseItems }, { ...CONTEXT, newId: counter() });
  assert.ok(plan.items.every((item) => item.categoryId === null));
});

async function gone(path: string): Promise<boolean> {
  try { await access(path); return false; } catch { return true; }
}

test("migrate: applies once, saves before renaming sources, keeps the originals, and re-runs as a no-op", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viral-migrate-"));
  try {
    const remindersPath = join(dir, "dashboard", "reminders.json");
    const organisePath = join(dir, "dashboard", "organise", "items.json");
    const exportedPath = join(dir, "calendar", "exported-old-organise.json");
    await mkdir(join(dir, "dashboard", "organise"), { recursive: true });
    await mkdir(join(dir, "calendar"), { recursive: true });
    await writeFile(remindersPath, JSON.stringify(dashboardReminders), "utf8");
    await writeFile(organisePath, JSON.stringify(organiseItems), "utf8");

    const store = new JsonDocumentStore<CalendarDocument>(join(dir, "calendar", "store.json"), validateCalendarDocument, emptyCalendarDocument);
    const migration = new OrganiseMigration(store, { dashboardReminders: remindersPath, organiseItems: organisePath, exported: exportedPath }, { clock: () => new Date("2026-11-24T00:00:00Z"), newId: counter() });

    const first = await migration.run();
    assert.deepEqual([first.alreadyDone, first.reminders, first.tasks, first.exported], [false, 3, 1, 2]);

    const document = await store.read();
    assert.equal(document.items.length, 4, "four items landed in the new store");
    assert.ok(document.migrations.includes("organise-v1"), "the migration is recorded in the store");

    const exported = JSON.parse(await readFile(exportedPath, "utf8")) as { items: unknown[] };
    assert.equal(exported.items.length, 2);

    assert.ok(await gone(remindersPath), "the source reminder file was renamed away");
    assert.ok(!(await gone(`${remindersPath}.migrated`)), "the original is kept as *.migrated, not deleted");
    assert.ok(!(await gone(`${organisePath}.migrated`)), "the organise source is kept as *.migrated");

    const second = await migration.run();
    assert.equal(second.alreadyDone, true, "a re-run does nothing");
    assert.equal((await store.read()).items.length, 4, "no duplicate items are added");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
