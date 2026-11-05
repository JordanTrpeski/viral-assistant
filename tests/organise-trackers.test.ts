import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NotFoundError } from "../src/dashboard/errors.js";
import { periodOf, previousPeriod, trackerView, type Tracker, type TrackerEntry, type TrackerView } from "../src/dashboard/organise/trackers.js";
import { withServer, withTempDir } from "./dashboard-helpers.js";
import { openOrganise } from "./organise-helpers.js";

// 2026-10-14 is a Wednesday.
const today = "2026-10-14";

function tracker(period: Tracker["period"], target: number | null = null): Tracker {
  return { id: "t", name: "Running", unit: "km", target, period, project_id: null, created_at: "", updated_at: "" };
}

function entry(date: string, value: number): TrackerEntry {
  return { id: `${date}-${value}`, tracker_id: "t", date, value, note: "", created_at: "", updated_at: "" };
}

test("period boundaries: weekly Monday to Sunday (across months), monthly calendar month, yearly calendar year", () => {
  assert.deepEqual(periodOf("weekly", "2026-10-14"), { start: "2026-10-12", end: "2026-10-18" });
  assert.deepEqual(periodOf("weekly", "2026-10-18"), { start: "2026-10-12", end: "2026-10-18" }, "Sunday ends the week");
  assert.deepEqual(periodOf("weekly", "2026-10-19"), { start: "2026-10-19", end: "2026-10-25" }, "Monday starts a new week");
  assert.deepEqual(periodOf("weekly", "2026-09-30"), { start: "2026-09-28", end: "2026-10-04" }, "a week is not cut at the month end");
  assert.deepEqual(periodOf("monthly", "2026-02-10"), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(periodOf("monthly", "2028-02-10"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(periodOf("yearly", "2026-10-14"), { start: "2026-01-01", end: "2026-12-31" });
  assert.deepEqual(previousPeriod("monthly", periodOf("monthly", "2026-01-15")), { start: "2025-12-01", end: "2025-12-31" });
  assert.deepEqual(previousPeriod("yearly", periodOf("yearly", "2026-06-01")), { start: "2025-01-01", end: "2025-12-31" });
});

test("progress: sum in the current period against the target as value, percent and remaining; no target shows the total only", () => {
  const entries = [entry("2026-10-11", 9), entry("2026-10-12", 5), entry("2026-10-14", 7.5), entry("2026-10-18", 2.5), entry("2026-10-19", 99)];
  const weekly = trackerView(tracker("weekly", 20), entries, today);
  assert.deepEqual([weekly.progress.start, weekly.progress.end, weekly.progress.total, weekly.progress.percent, weekly.progress.remaining], ["2026-10-12", "2026-10-18", 15, 75, 5]);
  const over = trackerView(tracker("weekly", 10), entries, today);
  assert.deepEqual([over.progress.percent, over.progress.remaining], [150, 0], "over target: remaining never negative");
  const free = trackerView(tracker("weekly"), entries, today);
  assert.deepEqual([free.progress.total, free.progress.target, free.progress.percent, free.progress.remaining], [15, null, null, null]);
  const fractions = trackerView(tracker("weekly"), [entry("2026-10-13", 0.1), entry("2026-10-13", 0.2)], today);
  assert.equal(fractions.progress.total, 0.3);
});

test("history: totals for the last 8 periods, oldest first, ending with the current one", () => {
  const entries = [entry("2026-10-14", 3), entry("2026-10-05", 4), entry("2026-08-24", 6), entry("2026-08-23", 100)];
  const weekly = trackerView(tracker("weekly"), entries, today);
  assert.equal(weekly.history.length, 8);
  assert.deepEqual(weekly.history.map((period) => period.start), ["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"]);
  assert.deepEqual(weekly.history.map((period) => period.total), [6, 0, 0, 0, 0, 0, 4, 3], "2026-08-23 is just outside the 8 weeks");
  const monthly = trackerView(tracker("monthly"), [entry("2026-03-31", 1), entry("2026-02-15", 50)], today);
  assert.deepEqual([monthly.history[0]!.start, monthly.history[0]!.total, monthly.history.at(-1)!.start], ["2026-03-01", 1, "2026-10-01"]);
  const yearly = trackerView(tracker("yearly"), [entry("2019-06-01", 2), entry("2018-06-01", 5)], today);
  assert.deepEqual([yearly.history[0]!.start, yearly.history[0]!.total], ["2019-01-01", 2]);
});

test("trackers and entries: create, edit and delete live; validation; unknown ids; delete removes entries", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const created = await organise.createTracker({ name: "Reading", unit: "pages", target: 200, period: "weekly" });
    assert.deepEqual([created.name, created.unit, created.target, created.period, created.progress.total], ["Reading", "pages", 200, "weekly", 0]);
    const first = await organise.addEntry(created.id, { value: 40, note: "Dune" });
    assert.equal(first.date, today, "date defaults to today");
    const second = await organise.addEntry(created.id, { date: "2026-10-12", value: 30 });
    assert.equal((await organise.getTracker(created.id)).progress.total, 70);
    await organise.updateEntry(created.id, first.id, { value: 60 });
    assert.equal((await organise.getTracker(created.id)).progress.total, 90, "editing an entry updates progress");
    await organise.updateEntry(created.id, second.id, { date: "2026-10-01" });
    assert.equal((await organise.getTracker(created.id)).progress.total, 60, "moving an entry out of the period");
    await organise.deleteEntry(created.id, first.id);
    assert.equal((await organise.getTracker(created.id)).progress.total, 0);
    assert.deepEqual((await organise.listEntries(created.id)).map((item) => item.id), [second.id]);
    assert.equal((await organise.updateTracker(created.id, { target: null, period: "monthly" })).progress.target, null);
    await assert.rejects(organise.addEntry(created.id, { value: -1 }), /value must be a number, 0 or more/);
    await assert.rejects(organise.addEntry(created.id, { value: "5" }), /value must be a number/);
    await assert.rejects(organise.addEntry(created.id, { value: 1, date: "2026-02-31" }), /valid date/);
    await assert.rejects(organise.addEntry(created.id, { value: 1, mood: "good" }), /Unknown field/);
    assert.equal((await organise.addEntry(created.id, { value: 0 })).value, 0, "zero is allowed");
    await assert.rejects(organise.createTracker({ name: "", period: "weekly" }), /name must be 1 to 100 characters/);
    await assert.rejects(organise.createTracker({ name: "x", period: "daily" }), /period must be one of: weekly, monthly, yearly/);
    await assert.rejects(organise.createTracker({ name: "x", period: "weekly", target: 0 }), /target must be a number greater than 0/);
    await assert.rejects(organise.createTracker({ name: "x", period: "weekly", project_id: "missing" }), /is not an existing project/);
    await assert.rejects(organise.addEntry("missing", { value: 1 }), NotFoundError);
    await assert.rejects(organise.updateEntry(created.id, "missing", { value: 1 }), NotFoundError);
    await organise.deleteTracker(created.id);
    assert.deepEqual((await organise.trackers.read()).entries, [], "deleting a tracker deletes its entries");
    await assert.rejects(organise.getTracker(created.id), NotFoundError);
    assert.deepEqual((await readdir(join(directory, "organise"))).sort(), ["trackers.json"]);
  });
});

test("a tracker can belong to a project: it shows on the project page and blocks deleting the project", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const project = await organise.createItem({ type: "project", title: "Marathon" });
    const running = await organise.createTracker({ name: "Running", unit: "km", target: 30, period: "weekly", project_id: project.id });
    assert.deepEqual((await organise.projectPage(project.id)).sections.trackers.map((item) => item.id), [running.id]);
    await assert.rejects(organise.deleteItem(project.id), /1 tracker\(s\) still belong to it/);
    await organise.updateTracker(running.id, { project_id: null });
    await organise.deleteItem(project.id);
  });
});

test("routes: trackers and entries over HTTP", async () => {
  await withServer(today, async ({ call }) => {
    const created = await call<TrackerView>("POST", "/api/organise/trackers", { name: "Steps", unit: "", target: 70_000, period: "weekly" });
    assert.equal(created.status, 201);
    const added = await call<TrackerEntry>("POST", `/api/organise/trackers/${created.body.id}/entries`, { value: 8_000 });
    assert.equal(added.status, 201);
    assert.equal((await call<TrackerView[]>("GET", "/api/organise/trackers")).body[0]!.progress.total, 8_000);
    assert.equal((await call<TrackerEntry>("PATCH", `/api/organise/trackers/${created.body.id}/entries/${added.body.id}`, { value: 9_000 })).body.value, 9_000);
    assert.equal((await call("PATCH", `/api/organise/trackers/${created.body.id}`, { period: "hourly" })).status, 400);
    assert.equal((await call("GET", "/api/organise/trackers/missing/entries")).status, 404);
    assert.equal((await call("DELETE", `/api/organise/trackers/${created.body.id}/entries/${added.body.id}`)).status, 204);
    assert.equal((await call("DELETE", `/api/organise/trackers/${created.body.id}`)).status, 204);
    assert.equal((await call("DELETE", `/api/organise/trackers/${created.body.id}`)).status, 404);
  });
});
