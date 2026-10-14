import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendar, collapseDay, itemsInWindow, maxVisiblePerDay, type CalendarMonth } from "../src/dashboard/calendar.js";
import type { ColourCategory } from "../src/dashboard/shared/colours.js";
import { prepareEntries, type TimelineItem } from "../src/dashboard/timeline.js";
import { withServer } from "./dashboard-helpers.js";

function item(date: string, colour: ColourCategory, label: string, extra: Partial<TimelineItem> = {}): TimelineItem {
  return { id: `test:${label}`, date, source: "transaction", sourceId: label, label, colour, status: "scheduled", amountCents: 100, prepareBy: null, ...extra };
}

test("+N more: at most two entries per day, the rest counted", () => {
  const entries = (count: number): TimelineItem[] => Array.from({ length: count }, (_, index) => item("2026-11-10", "spending", `e${index}`));
  assert.equal(maxVisiblePerDay, 2);
  assert.deepEqual([0, 1, 2, 3, 5].map((count) => collapseDay(entries(count)).moreCount), [0, 0, 0, 1, 3]);
  assert.deepEqual(collapseDay(entries(5)).visible.map((entry) => entry.label), ["e0", "e1"]);
});

test("calendar: Monday-first weeks covering the month, with neighbouring days marked and today flagged", () => {
  const calendar = buildCalendar([], "2026-11", "2026-11-15");
  assert.equal(calendar.weeks.length, 6);
  assert.equal(calendar.weeks[0]?.[0]?.date, "2026-10-26");
  assert.equal(calendar.weeks[0]?.[0]?.inMonth, false);
  assert.equal(calendar.weeks[0]?.[6]?.date, "2026-11-01");
  assert.equal(calendar.weeks[0]?.[6]?.inMonth, true);
  assert.equal(calendar.weeks.at(-1)?.[6]?.date, "2026-12-06");
  assert.deepEqual(calendar.weeks.flat().filter((day) => day.isToday).map((day) => day.date), ["2026-11-15"]);
  assert.equal(buildCalendar([], "2027-02", "2026-11-15").weeks.length, 4, "February 2027 starts on a Monday and fills exactly four weeks");
});

test("calendar: entries sorted by category, '+N more' computed per day, hidden categories excluded from cells and counts", () => {
  const items = [
    item("2026-11-10", "spending", "Lunch"), item("2026-11-10", "bills", "Rent"), item("2026-11-10", "reminder", "Call mum"),
    item("2026-11-10", "income", "Pay"), item("2026-11-11", "personal", "Birthday"), item("2026-12-02", "bills", "Next rent"), item("2027-01-01", "bills", "Far away")
  ];
  const all = buildCalendar(items, "2026-11", "2026-11-15");
  const day = all.weeks.flat().find((entry) => entry.date === "2026-11-10")!;
  assert.deepEqual(day.visible.map((entry) => entry.label), ["Rent", "Pay"]);
  assert.equal(day.moreCount, 2);
  assert.deepEqual(day.items.map((entry) => entry.label), ["Rent", "Pay", "Lunch", "Call mum"]);
  assert.deepEqual(all.weeks.flat().find((entry) => entry.date === "2026-12-02")?.visible.map((entry) => entry.label), ["Next rent"], "trailing days of the next month show entries");

  const hidden = buildCalendar(items, "2026-11", "2026-11-15", new Set<ColourCategory>(["bills", "income"]));
  const hiddenDay = hidden.weeks.flat().find((entry) => entry.date === "2026-11-10")!;
  assert.deepEqual(hiddenDay.visible.map((entry) => entry.label), ["Lunch", "Call mum"]);
  assert.equal(hiddenDay.moreCount, 0);
  const bills = hidden.legend.find((entry) => entry.category === "bills")!;
  assert.deepEqual([bills.hidden, bills.count, bills.colour, bills.label], [true, 1, "#f59e0b", "Bills"], "legend still counts hidden entries in the month");
  assert.deepEqual(hidden.legend.map((entry) => entry.category), ["bills", "income", "gym", "viral", "personal", "spending", "reminder"]);
});

test("prepare-by: a dated item with prepare_by gets a grey 'Prepare:' entry on that date", () => {
  const birthday = item("2026-12-01", "personal", "Anna's birthday", { source: "reminder", sourceId: "r1", prepareBy: "2026-11-17", amountCents: null });
  const [prepare] = prepareEntries([birthday, item("2026-11-20", "bills", "No prepare")], "2026-11-15");
  assert.deepEqual(prepare, {
    id: "prepare:r1", date: "2026-11-17", source: "prepare", sourceId: "r1", label: "Prepare: Anna's birthday",
    colour: "reminder", status: "scheduled", amountCents: null, prepareBy: null
  });
  assert.equal(prepareEntries([birthday], "2026-11-18")[0]?.status, "scheduled", "a passed prepare-by date before the event is overdue, not done");
  assert.equal(prepareEntries([birthday], "2026-12-02")[0]?.status, "done", "once the event has passed, preparing is done");
  assert.equal(prepareEntries([{ ...birthday, status: "done" }], "2026-11-15")[0]?.status, "done", "a done reminder's preparation is done");
  assert.equal(prepareEntries([birthday, item("2026-11-20", "bills", "x")], "2026-11-15").length, 1);
  const calendar = buildCalendar([birthday, ...prepareEntries([birthday], "2026-11-15")], "2026-11", "2026-11-15");
  assert.deepEqual(calendar.weeks.flat().find((day) => day.date === "2026-11-17")?.visible.map((entry) => entry.label), ["Prepare: Anna's birthday"]);
});

test("window: items from a start date for N days, inclusive", () => {
  const items = [item("2026-11-14", "bills", "before"), item("2026-11-15", "bills", "first"), item("2026-11-21", "income", "last"), item("2026-11-22", "bills", "after")];
  assert.deepEqual(itemsInWindow(items, "2026-11-15", 7).map((entry) => entry.label), ["first", "last"]);
});

test("routes: the calendar reflects transactions as they are created, edited and deleted, and validates its query", async () => {
  await withServer("2026-11-15", async ({ call }) => {
    const created = await call<{ id: string }>("POST", "/api/finance/transactions", { categoryId: "rent", amountCents: 95_000, date: "2026-11-01", note: "Rent" });
    for (const note of ["Lunch", "Dinner", "Snack"]) await call("POST", "/api/finance/transactions", { categoryId: "groceries", amountCents: 1_000, date: "2026-11-01", note });
    let calendar = (await call<CalendarMonth>("GET", "/api/calendar?month=2026-11")).body;
    let first = calendar.weeks.flat().find((day) => day.date === "2026-11-01")!;
    assert.deepEqual([first.visible.map((entry) => entry.label), first.moreCount], [["Rent", "Dinner"], 2]);
    assert.equal(first.visible[0]?.colour, "bills");

    await call("PATCH", `/api/finance/transactions/${created.body.id}`, { date: "2026-11-03" });
    calendar = (await call<CalendarMonth>("GET", "/api/calendar?month=2026-11&hidden=spending")).body;
    first = calendar.weeks.flat().find((day) => day.date === "2026-11-01")!;
    assert.deepEqual([first.items.length, first.moreCount], [0, 0], "spending hidden, rent moved away");
    assert.equal(calendar.weeks.flat().find((day) => day.date === "2026-11-03")?.visible[0]?.label, "Rent");

    await call("DELETE", `/api/finance/transactions/${created.body.id}`);
    calendar = (await call<CalendarMonth>("GET", "/api/calendar")).body;
    assert.equal(calendar.month, "2026-11", "defaults to the current month");
    assert.equal(calendar.legend.find((entry) => entry.category === "bills")?.count, 0);

    assert.equal((await call("GET", "/api/calendar?month=2026-13")).status, 400);
    const badHidden = await call<{ error: string }>("GET", "/api/calendar?hidden=bills,boats");
    assert.equal(badHidden.status, 400);
    assert.match(badHidden.body.error, /unknown: boats/);
    const window = await call<{ from: string; items: TimelineItem[] }>("GET", "/api/timeline?from=2026-11-01&days=2");
    assert.deepEqual([window.body.from, window.body.items.length], ["2026-11-01", 3]);
    assert.equal((await call("GET", "/api/timeline?days=0")).status, 400);
    assert.equal((await call("GET", "/api/timeline?days=400")).status, 400);
  });
});
