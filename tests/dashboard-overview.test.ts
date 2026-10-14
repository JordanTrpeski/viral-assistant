import assert from "node:assert/strict";
import test from "node:test";
import type { MonthBudget, WeekBudget } from "../src/dashboard/budget.js";
import { nextSevenDays, reminderPanel, type ReminderPanelItem } from "../src/dashboard/overview.js";
import type { ColourCategory } from "../src/dashboard/shared/colours.js";
import type { TimelineItem, TimelineSource } from "../src/dashboard/timeline.js";
import { withServer } from "./dashboard-helpers.js";

interface Overview {
  today: string;
  nextSevenDays: TimelineItem[];
  reminders: ReminderPanelItem[];
  budget: { stepCents: number; week: WeekBudget; month: MonthBudget };
}

function item(date: string, label: string, source: TimelineSource = "transaction", colour: ColourCategory = "bills", status: "done" | "scheduled" = "scheduled"): TimelineItem {
  return { id: `${source}:${label}`, date, source, sourceId: label, label, colour, status, amountCents: source === "transaction" ? 100 : null, prepareBy: null };
}

test("next 7 days: today through today + 6, in calendar order", () => {
  const items = [item("2026-11-14", "yesterday"), item("2026-11-21", "sixth"), item("2026-11-15", "today"), item("2026-11-22", "seventh"), item("2026-11-18", "middle")];
  assert.deepEqual(nextSevenDays(items, "2026-11-15").map((entry) => entry.label), ["today", "middle", "sixth"]);
  assert.deepEqual(nextSevenDays(items, "2026-11-30").map((entry) => entry.label), [], "crosses into December without error");
});

test("reminders panel: open reminders and prepare-by entries, overdue flagged, 30-day horizon, at most eight", () => {
  const items = [
    item("2026-11-10", "overdue call", "reminder", "reminder"),
    item("2026-11-12", "finished", "reminder", "reminder", "done"),
    item("2026-11-16", "Prepare: party", "prepare", "reminder"),
    item("2026-11-20", "rent", "transaction", "bills"),
    item("2026-12-15", "party", "reminder", "personal"),
    item("2026-12-16", "too far", "reminder", "personal")
  ];
  const panel = reminderPanel(items, "2026-11-15");
  assert.deepEqual(panel.map((entry) => [entry.label, entry.overdue]), [["overdue call", true], ["Prepare: party", false], ["party", false]]);
  const many = Array.from({ length: 12 }, (_, index) => item(`2026-11-${String(16 + index).padStart(2, "0")}`, `r${index}`, "reminder", "reminder"));
  assert.equal(reminderPanel(many, "2026-11-15").length, 8);
});

test("overview: Sunday 1 November is a one-day budget week; the month shows committed bills and flexible targets", async () => {
  await withServer("2026-11-01", async ({ call }) => {
    await call("PATCH", "/api/finance/targets/groceries", { weeklyCents: 7_000, monthlyCents: 30_000 });
    await call("POST", "/api/finance/transactions", { categoryId: "rent", amountCents: 95_000, date: "2026-11-01", note: "Rent" });
    await call("POST", "/api/finance/transactions", { categoryId: "phone", amountCents: 2_500, date: "2026-11-05", note: "Phone" });
    await call("POST", "/api/finance/transactions", { categoryId: "groceries", amountCents: 1_234, date: "2026-11-01" });
    await call("POST", "/api/finance/transactions", { categoryId: "groceries", amountCents: 4_000, date: "2026-11-02" });
    const overview = (await call<Overview>("GET", "/api/overview")).body;
    assert.deepEqual([overview.budget.week.start, overview.budget.week.end, overview.budget.week.days], ["2026-11-01", "2026-11-01", 1]);
    assert.deepEqual([overview.budget.week.spentCents, overview.budget.week.targetCents], [1_234, 1_000], "rent never counts in a week; target prorated to one day");
    assert.deepEqual(overview.budget.month.committed.map((bill) => bill.label), ["Rent", "Phone"]);
    assert.equal(overview.budget.month.committedCents, 97_500);
    assert.equal(overview.budget.month.spentCents, 5_234);
    assert.equal(overview.budget.stepCents, 1_000);
    assert.deepEqual(overview.nextSevenDays.map((entry) => [entry.date, entry.label, entry.colour, entry.amountCents]), [
      ["2026-11-01", "Rent", "bills", 95_000], ["2026-11-01", "Groceries", "spending", 1_234], ["2026-11-02", "Groceries", "spending", 4_000], ["2026-11-05", "Phone", "bills", 2_500]
    ]);
    assert.deepEqual(overview.reminders, []);
  });
});

test("overview: Monday 2 November starts a full seven-day week", async () => {
  await withServer("2026-11-02", async ({ call }) => {
    await call("PATCH", "/api/finance/targets/groceries", { weeklyCents: 7_000 });
    await call("POST", "/api/finance/transactions", { categoryId: "groceries", amountCents: 1_234, date: "2026-11-01" });
    await call("POST", "/api/finance/transactions", { categoryId: "groceries", amountCents: 500, date: "2026-11-08" });
    const week = (await call<Overview>("GET", "/api/overview")).body.budget.week;
    assert.deepEqual([week.start, week.end, week.days, week.targetCents, week.spentCents], ["2026-11-02", "2026-11-08", 7, 7_000, 500]);
  });
});

test("overview and modules stay in step: a change in Finance shows on the Overview, and the Overview's − / + changes Finance", async () => {
  await withServer("2026-11-10", async ({ call }) => {
    const created = await call<{ id: string }>("POST", "/api/finance/transactions", { categoryId: "groceries", amountCents: 1_000, date: "2026-11-10" });
    await call("PATCH", `/api/finance/transactions/${created.body.id}`, { amountCents: 2_500 });
    let overview = (await call<Overview>("GET", "/api/overview")).body;
    assert.equal(overview.budget.week.spentCents, 2_500);
    assert.equal(overview.nextSevenDays[0]?.amountCents, 2_500);
    await call("POST", "/api/finance/targets/groceries/step", { period: "monthly", direction: 1 });
    await call("POST", "/api/finance/targets/groceries/step", { period: "monthly", direction: 1 });
    overview = (await call<Overview>("GET", "/api/overview")).body;
    assert.equal(overview.budget.month.rows.find((row) => row.categoryId === "groceries")?.targetCents, 2_000);
    const targets = (await call<{ categoryId: string; monthlyCents: number; weeklyCents: number }[]>("GET", "/api/finance/targets")).body;
    assert.deepEqual(targets.find((target) => target.categoryId === "groceries"), { categoryId: "groceries", weeklyCents: 0, monthlyCents: 2_000 }, "weekly target untouched");
    await call("DELETE", `/api/finance/transactions/${created.body.id}`);
    overview = (await call<Overview>("GET", "/api/overview")).body;
    assert.deepEqual([overview.budget.week.spentCents, overview.nextSevenDays.length], [0, 0]);
  });
});
