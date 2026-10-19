import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarMonth } from "../src/dashboard/calendar.js";
import type { OrganiseItem } from "../src/dashboard/organise/model.js";
import { groupReminders, nextYearly, type ReminderGroups } from "../src/dashboard/organise/reminders.js";
import type { TimelineItem } from "../src/dashboard/timeline.js";
import { withServer, withTempDir } from "./dashboard-helpers.js";
import { openOrganise } from "./organise-helpers.js";

const today = "2026-10-14";

test("recurrence: yearly next date, with 29 February kept across non-leap years", () => {
  assert.equal(nextYearly("2026-03-10", "03-10"), "2027-03-10");
  assert.equal(nextYearly("2026-12-31", null), "2027-12-31");
  assert.equal(nextYearly("2028-02-29", "02-29"), "2029-02-28");
  assert.equal(nextYearly("2029-02-28", "02-29"), "2030-02-28");
  assert.equal(nextYearly("2031-02-28", "02-29"), "2032-02-29", "back on the 29th in the next leap year");
  assert.equal(nextYearly("2027-02-28", "02-28"), "2028-02-28", "a 28 February series stays on the 28th");
});

test("completing a yearly reminder marks it done and creates the next occurrence with the same fields", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const project = await organise.createItem({ type: "project", title: "Family" });
    const birthday = await organise.createItem({ type: "reminder", title: "Anna's birthday", date: "2026-12-01", category: "Personal", recurrence: "yearly", project_id: project.id, notes: "Book table" });
    assert.equal(birthday.prepare_by, "2026-11-17");
    const done = await organise.updateItem(birthday.id, { status: "done" });
    assert.match(done.done_at ?? "", /^2026-10-14/);
    const reminders = await organise.listItems({ type: "reminder" });
    assert.equal(reminders.length, 2, "the done occurrence is kept");
    const next = reminders.find((item) => item.id !== birthday.id)!;
    assert.deepEqual([next.title, next.date, next.prepare_by, next.category, next.recurrence, next.project_id, next.notes, next.status, next.done_at],
      ["Anna's birthday", "2027-12-01", "2027-11-17", "Personal", "yearly", project.id, "Book table", "open", null]);
    await organise.updateItem(birthday.id, { status: "open" });
    await organise.updateItem(birthday.id, { status: "done" });
    assert.equal((await organise.listItems({ type: "reminder" })).length, 2, "re-completing does not schedule a duplicate");
  });
});

test("yearly leap-day series through four completions; custom recurrence advances by interval_days", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    let current = await organise.createItem({ type: "reminder", title: "Leap birthday", date: "2028-02-29", recurrence: "yearly" });
    const dates = [current.date];
    for (let step = 0; step < 4; step += 1) {
      await organise.updateItem(current.id, { status: "done" });
      current = (await organise.listItems({ type: "reminder" })).find((item) => item.status === "open")!;
      dates.push(current.date);
    }
    assert.deepEqual(dates, ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
    assert.equal(current.recurrence_anchor, "02-29");
    const plants = await organise.createItem({ type: "reminder", title: "Water plants", date: "2026-10-14", recurrence: "custom", interval_days: 3, prepare_by: "2026-10-13" });
    await organise.updateItem(plants.id, { status: "done" });
    const next = (await organise.listItems({ type: "reminder" })).find((item) => item.title === "Water plants" && item.status === "open")!;
    assert.deepEqual([next.date, next.prepare_by, next.interval_days], ["2026-10-17", "2026-10-16", 3]);
    const once = await organise.createItem({ type: "reminder", title: "One-off", date: "2026-10-20" });
    await organise.updateItem(once.id, { status: "done" });
    assert.equal((await organise.listItems({ type: "reminder" })).filter((item) => item.title === "One-off").length, 1, "no recurrence, no next occurrence");
  });
});

test("prepare_by: Personal defaults to 14 days before, others to none; override, prepare_days and zero means none", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const personal = await organise.createItem({ type: "reminder", title: "Wedding", date: "2026-11-30", category: "Personal" });
    assert.equal(personal.prepare_by, "2026-11-16");
    assert.equal((await organise.createItem({ type: "reminder", title: "Dentist", date: "2026-11-30", category: "Health" })).prepare_by, null);
    assert.equal((await organise.createItem({ type: "reminder", title: "Gift", date: "2026-11-30", category: "Personal", prepare_by: "2026-11-01" })).prepare_by, "2026-11-01", "an explicit prepare_by wins");
    assert.equal((await organise.createItem({ type: "reminder", title: "Gift 2", date: "2026-11-30", category: "Personal", prepare_by: null })).prepare_by, null, "explicit null means none");
    assert.equal((await organise.createItem({ type: "reminder", title: "Gift 3", date: "2026-11-30", category: "Personal", prepare_days: 0 })).prepare_by, null, "zero means none");
    assert.equal((await organise.updateItem(personal.id, { date: "2026-12-10" })).prepare_by, "2026-11-26", "the default follows a date change");
    assert.equal((await organise.updateItem(personal.id, { prepare_days: 7 })).prepare_by, "2026-12-03");
    assert.equal((await organise.updateItem(personal.id, { date: "2026-12-20" })).prepare_by, "2026-12-03", "a custom prepare_by stays put");
    assert.equal((await organise.updateItem(personal.id, { prepare_days: 0 })).prepare_by, null);
    const health = await organise.createItem({ type: "reminder", title: "Checkup", date: "2026-12-01", category: "Health" });
    assert.equal((await organise.updateItem(health.id, { category: "Personal" })).prepare_by, "2026-11-17", "switching to Personal adds the default");
    await assert.rejects(organise.updateItem(health.id, { prepare_days: 400 }), /prepare_days must be a whole number from 0 to 365/);
    await assert.rejects(organise.updateItem(health.id, { prepare_days: 3, prepare_by: "2026-11-20" }), /not both/);
    await assert.rejects(organise.createItem({ type: "task", title: "x", prepare_days: 3 }), /prepare_days only applies to reminders/);
    const sorted = await organise.sortInbox((await organise.addToInbox({ text: "Mum's birthday" })).id, { type: "reminder", date: "2026-12-24", category: "Personal" });
    assert.equal(sorted.prepare_by, "2026-12-10", "the default applies when sorting from the inbox too");
  });
});

test("overdue flag: open reminders dated before today; done ones never", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    await organise.createItem({ type: "reminder", title: "late", date: "2026-10-13" });
    await organise.createItem({ type: "reminder", title: "today", date: "2026-10-14" });
    const doneLate = await organise.createItem({ type: "reminder", title: "done late", date: "2026-10-01" });
    await organise.updateItem(doneLate.id, { status: "done" });
    const groups = groupReminders(await organise.listItems(), today);
    assert.deepEqual(groups.overdue.map((item: OrganiseItem & { overdue: boolean }) => [item.title, item.overdue]), [["late", true]]);
    assert.deepEqual(groups.upcoming.map((item) => item.title), ["today"]);
    assert.deepEqual(groups.done.map((item) => [item.title, item.overdue]), [["done late", false]]);
  });
});

test("calendar and Next 7 days show Organise reminders with their Prepare: entries", async () => {
  await withServer(today, async ({ call }) => {
    const birthday = (await call<OrganiseItem>("POST", "/api/organise/items", { type: "reminder", title: "Anna's birthday", date: "2026-10-28", category: "Personal" })).body;
    await call("POST", "/api/organise/items", { type: "reminder", title: "Rent reminder", date: "2026-10-16", category: "Bill" });
    const calendar = (await call<CalendarMonth>("GET", "/api/calendar?month=2026-10")).body;
    const day = (date: string) => calendar.weeks.flat().find((entry) => entry.date === date)!;
    assert.deepEqual(day("2026-10-28").visible.map((entry) => [entry.label, entry.colour, entry.origin]), [["Anna's birthday", "personal", "organise"]]);
    assert.deepEqual(day("2026-10-14").visible.map((entry) => [entry.label, entry.colour, entry.origin, entry.source]), [["Prepare: Anna's birthday", "reminder", "organise", "prepare"]]);
    assert.deepEqual(day("2026-10-16").visible.map((entry) => [entry.label, entry.colour]), [["Rent reminder", "bills"]]);
    const week = (await call<{ items: TimelineItem[] }>("GET", "/api/timeline?days=7")).body.items;
    assert.deepEqual(week.map((entry) => entry.label), ["Prepare: Anna's birthday", "Rent reminder"]);
    await call("PATCH", `/api/organise/items/${birthday.id}`, { status: "done" });
    const after = (await call<CalendarMonth>("GET", "/api/calendar?month=2026-10")).body;
    assert.equal(after.weeks.flat().find((entry) => entry.date === "2026-10-28")?.visible[0]?.status, "done");
    const groups = (await call<ReminderGroups>("GET", "/api/organise/reminders")).body;
    assert.deepEqual([groups.upcoming.map((item) => item.date), groups.done.map((item) => item.title)], [["2026-10-16"], ["Anna's birthday"]], "Personal without yearly recurrence does not repeat");
  });
});
