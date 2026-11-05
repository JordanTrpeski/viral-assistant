import assert from "node:assert/strict";
import test from "node:test";
import type { MonthBudget, WeekAllowanceBudget } from "../src/dashboard/budget.js";
import { nextSevenDays, reminderPanel, type ReminderPanelItem } from "../src/dashboard/overview.js";
import type { ColourCategory } from "../src/dashboard/shared/colours.js";
import type { TimelineItem, TimelineSource } from "../src/dashboard/timeline.js";
import { withServer } from "./dashboard-helpers.js";

interface Overview {
  today: string;
  nextSevenDays: TimelineItem[];
  reminders: ReminderPanelItem[];
  budget: { weekly: WeekAllowanceBudget; month: MonthBudget };
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

test("overview week: the daily-rate allowance for spread categories only, agreeing with the Budget tab; month keeps every category", async () => {
  await withServer("2026-11-10", async ({ call }) => {
    await call("PATCH", "/api/finance/categories/groceries", { spreadWeekly: true });
    await call("PATCH", "/api/finance/targets/groceries", { monthlyCents: 30_000 });
    await call("PATCH", "/api/finance/targets/entertainment", { monthlyCents: 15_000 }); // left off (default)
    await call("POST", "/api/finance/transactions", { categoryId: "groceries", amountCents: 1_000, date: "2026-11-10" });
    await call("POST", "/api/finance/transactions", { categoryId: "entertainment", amountCents: 2_000, date: "2026-11-10" });
    const overview = (await call<Overview>("GET", "/api/overview")).body;
    const budget = (await call<{ weekly: WeekAllowanceBudget }>("GET", "/api/budget")).body;

    assert.deepEqual(overview.budget.weekly.rows.map((row) => row.categoryId), ["groceries"], "only spread categories appear in the week view");
    assert.deepEqual(overview.budget.weekly, budget.weekly, "Overview and the Budget tab agree on the weekly figures");
    assert.equal(overview.budget.weekly.rows[0]?.allowanceCents, 7_000, "€300 ÷ 30 days × 7");
    assert.equal(overview.budget.weekly.rows[0]?.spentCents, 1_000, "the off category's spend is excluded");

    const monthIds = overview.budget.month.rows.map((row) => row.categoryId);
    for (const id of ["groceries", "entertainment", "transport"]) assert.ok(monthIds.includes(id), `${id} is still in the month view`);

    assert.equal("stepCents" in (overview.budget as Record<string, unknown>), false, "Overview budget stays read-only");
    assert.doesNotMatch(JSON.stringify(overview.budget), /step/i, "Overview budget exposes no edit controls");
  });
});

test("overview week: switching a category off removes it from the week view and its total, but not the month view", async () => {
  await withServer("2026-11-10", async ({ call }) => {
    await call("PATCH", "/api/finance/categories/groceries", { spreadWeekly: true });
    await call("PATCH", "/api/finance/targets/groceries", { monthlyCents: 30_000 });
    let overview = (await call<Overview>("GET", "/api/overview")).body;
    assert.deepEqual(overview.budget.weekly.rows.map((row) => row.categoryId), ["groceries"]);

    await call("PATCH", "/api/finance/categories/groceries", { spreadWeekly: false });
    overview = (await call<Overview>("GET", "/api/overview")).body;
    assert.deepEqual(overview.budget.weekly.rows, [], "the week view is empty once nothing is spread");
    assert.equal(overview.budget.weekly.allowanceCents, 0, "the weekly total covers spread categories only");
    assert.ok(overview.budget.month.rows.some((row) => row.categoryId === "groceries"), "it stays in the month view");
  });
});

test("overview reflects Finance edits on a spread category's weekly figure", async () => {
  await withServer("2026-11-10", async ({ call }) => {
    await call("PATCH", "/api/finance/categories/groceries", { spreadWeekly: true });
    await call("PATCH", "/api/finance/targets/groceries", { monthlyCents: 30_000 });
    const created = await call<{ id: string }>("POST", "/api/finance/transactions", { categoryId: "groceries", amountCents: 1_000, date: "2026-11-10" });
    await call("PATCH", `/api/finance/transactions/${created.body.id}`, { amountCents: 2_500 });
    let overview = (await call<Overview>("GET", "/api/overview")).body;
    assert.equal(overview.budget.weekly.rows[0]?.spentCents, 2_500);
    assert.equal(overview.nextSevenDays[0]?.amountCents, 2_500);
    await call("DELETE", `/api/finance/transactions/${created.body.id}`);
    overview = (await call<Overview>("GET", "/api/overview")).body;
    assert.equal(overview.budget.weekly.rows[0]?.spentCents, 0);
    assert.equal(overview.nextSevenDays.length, 0);
  });
});
