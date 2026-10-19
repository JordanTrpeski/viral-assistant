import assert from "node:assert/strict";
import test from "node:test";
import { sevenDayFactor, type WeeklyReview } from "../src/dashboard/organise/review.js";
import { withServer, withTempDir } from "./dashboard-helpers.js";
import { movableClock, openOrganise } from "./organise-helpers.js";

// Review ends Wednesday 2026-10-14, so the window is Thursday 2026-10-08 to 2026-10-14 inclusive.
test("window edges: a task finished on the first day is in, one finished the day before is out, today is in", async () => {
  await withTempDir(async (directory) => {
    const time = movableClock("2026-10-07");
    const organise = openOrganise(directory, "2026-10-07", { clock: time.clock });
    const before = await organise.createItem({ type: "task", title: "finished the day before" });
    const first = await organise.createItem({ type: "task", title: "finished on the first day" });
    const last = await organise.createItem({ type: "task", title: "finished today" });
    const reopened = await organise.createItem({ type: "task", title: "finished then reopened" });
    await organise.updateItem(before.id, { status: "done" });
    time.advanceDays(1);
    await organise.updateItem(first.id, { status: "done" });
    await organise.updateItem(reopened.id, { status: "done" });
    await organise.updateItem(reopened.id, { status: "open" });
    time.advanceDays(6);
    await organise.updateItem(last.id, { status: "done" });
    const review = await organise.review();
    assert.deepEqual([review.start, review.end], ["2026-10-08", "2026-10-14"]);
    assert.deepEqual(review.done.tasks.map((task) => task.title), ["finished on the first day", "finished today"]);
    const earlier = await organise.review("2026-10-07");
    assert.deepEqual([earlier.start, earlier.done.tasks.map((task) => task.title)], ["2026-10-01", ["finished the day before"]], "an explicit end moves the window");
  });
});

test("done list items and tracker entries in the window", async () => {
  await withTempDir(async (directory) => {
    const time = movableClock("2026-10-07");
    const organise = openOrganise(directory, "2026-10-07", { clock: time.clock });
    const books = await organise.createList({ name: "Books", preset: "books" });
    const old = await organise.createItem({ type: "list_item", list_id: books.id, title: "Old book" });
    await organise.updateItem(old.id, { status: "finished" });
    time.advanceDays(3);
    const dune = await organise.createItem({ type: "list_item", list_id: books.id, title: "Dune" });
    await organise.updateItem(dune.id, { status: "finished" });
    const reading = await organise.createItem({ type: "list_item", list_id: books.id, title: "Emma", status: "reading" });
    const running = await organise.createTracker({ name: "Running", unit: "km", period: "weekly", target: 20 });
    await organise.addEntry(running.id, { date: "2026-10-07", value: 100 });
    await organise.addEntry(running.id, { date: "2026-10-08", value: 5 });
    await organise.addEntry(running.id, { date: "2026-10-14", value: 3.5 });
    await organise.addEntry(running.id, { date: "2026-10-15", value: 100 });
    time.advanceDays(4);
    const review = await organise.review();
    assert.deepEqual(review.done.listItems.map((row) => row.title), ["Dune"]);
    assert.ok(!review.done.listItems.some((row) => row.id === reading.id));
    assert.deepEqual(review.done.entries.map((entry) => [entry.tracker, entry.date, entry.value]), [["Running", "2026-10-08", 5], ["Running", "2026-10-14", 3.5]]);
    assert.deepEqual(review.trackers.map((tracker) => [tracker.total, tracker.target7, tracker.summary]), [[8.5, 20, "8.5 km of 20 km (7-day equivalent)"]], "a weekly target is used as is");
  });
});

test("trackers scaled to 7 days: monthly × 7/30.4375, yearly × 7/365.25, no target shows the total", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, "2026-10-14");
    const monthly = await organise.createTracker({ name: "Reading", unit: "pages", period: "monthly", target: 600 });
    await organise.addEntry(monthly.id, { date: "2026-10-10", value: 120 });
    const yearly = await organise.createTracker({ name: "Books", unit: "", period: "yearly", target: 52 });
    await organise.createTracker({ name: "Steps", unit: "", period: "weekly" });
    const review = await organise.review();
    assert.equal(sevenDayFactor.monthly, 7 / 30.4375);
    assert.deepEqual(review.trackers.map((tracker) => [tracker.name, tracker.target7, tracker.summary]), [
      ["Reading", 137.99, "120 pages of 137.99 pages (7-day equivalent)"],
      ["Books", 1, "0 of 1 (7-day equivalent)"],
      ["Steps", null, "0"]
    ]);
  });
});

test("slipped: open tasks due in the window before today, and open reminders dated in the window", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, "2026-10-14");
    await organise.createItem({ type: "task", title: "due on the first day", date: "2026-10-08" });
    await organise.createItem({ type: "task", title: "due the day before", date: "2026-10-07" });
    await organise.createItem({ type: "task", title: "due today", date: "2026-10-14" });
    const doneLate = await organise.createItem({ type: "task", title: "done late", date: "2026-10-09" });
    await organise.updateItem(doneLate.id, { status: "done" });
    await organise.createItem({ type: "reminder", title: "open reminder", date: "2026-10-12" });
    await organise.createItem({ type: "reminder", title: "today's reminder", date: "2026-10-14" });
    const doneReminder = await organise.createItem({ type: "reminder", title: "done reminder", date: "2026-10-10" });
    await organise.updateItem(doneReminder.id, { status: "done" });
    await organise.createItem({ type: "reminder", title: "outside", date: "2026-10-01" });
    const review = await organise.review();
    assert.deepEqual(review.slipped.tasks.map((task) => task.title), ["due on the first day"], "today's task has not slipped yet");
    assert.deepEqual(review.slipped.reminders.map((reminder) => reminder.title), ["open reminder", "today's reminder"]);
  });
});

test("routes: review over HTTP with optional end", async () => {
  await withServer("2026-10-14", async ({ call }) => {
    const review = await call<WeeklyReview>("GET", "/api/organise/review");
    assert.deepEqual([review.status, review.body.start, review.body.end], [200, "2026-10-08", "2026-10-14"]);
    assert.equal((await call<WeeklyReview>("GET", "/api/organise/review?end=2026-01-03")).body.start, "2025-12-28");
    assert.equal((await call("GET", "/api/organise/review?end=yesterday")).status, 400);
  });
});
