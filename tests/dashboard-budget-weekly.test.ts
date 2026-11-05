import assert from "node:assert/strict";
import test from "node:test";
import { dailyRateCents, daysInMonth, weekAllowance, weeklyAllowanceBudget, type SavedMonthlyLimit } from "../src/dashboard/budget.js";
import type { FinanceDocument } from "../src/dashboard/finance.js";

// Fixtures only — constructed limits and documents, never the real finance store.

test("weekly allowance: a boundary week (26 Oct–1 Nov) uses each month's daily rate, 6×X/31 + 1×Y/30", () => {
  const octoberLimit = 31 * 50; // €15.50 → 50c a day across 31 days
  const novemberLimit = 30 * 70; // €21.00 → 70c a day across 30 days
  const saved: SavedMonthlyLimit[] = [
    { month: "2026-10", limitCents: octoberLimit },
    { month: "2026-11", limitCents: novemberLimit }
  ];
  const result = weekAllowance(saved, "2026-10-26"); // 26–31 Oct (6 days) + 1 Nov (1 day)
  assert.equal(result.allowanceCents, 6 * (octoberLimit / 31) + 1 * (novemberLimit / 30));
  assert.equal(result.allowanceCents, 6 * 50 + 70);
  assert.equal(result.estimated, false);
});

test("weekly allowance: each month's daily rates sum to its limit exactly (28-day February and a 31-day month)", () => {
  for (const [month, limitCents] of [["2026-02", 10_000], ["2026-01", 10_000], ["2026-02", 9_999], ["2026-07", 12_345]] as const) {
    const days = daysInMonth(month);
    let sum = 0;
    for (let day = 1; day <= days; day += 1) sum += dailyRateCents(limitCents, month, day);
    assert.equal(sum, limitCents, `${month} (${days} days) with limit ${limitCents} must sum to the limit`);
  }
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(daysInMonth("2026-01"), 31);
});

test("weekly allowance: a month with no saved limit falls back to the most recent and marks the week estimated", () => {
  const saved: SavedMonthlyLimit[] = [{ month: "2026-10", limitCents: 31 * 50 }]; // November is missing
  const result = weekAllowance(saved, "2026-10-26"); // 1 Nov has no saved limit
  assert.equal(result.estimated, true);
  assert.equal(result.allowanceCents, 6 * 50 + dailyRateCents(31 * 50, "2026-11", 1));
});

test("weekly allowance: a stored weekly override replaces the calculated default for that category", () => {
  const document: FinanceDocument = {
    schemaVersion: 1,
    categories: [{ id: "groceries", name: "Groceries", kind: "flexible" }],
    transactions: [],
    targets: [{ categoryId: "groceries", weeklyCents: 5_000, monthlyCents: 31_000 }], // override €50; default would be €70
    settings: { openingBalanceCents: 0 }
  };
  const budget = weeklyAllowanceBudget(document, "2026-10-14"); // a full week inside October (31 days → €10/day)
  const row = budget.rows.find((entry) => entry.categoryId === "groceries");
  assert.ok(row);
  assert.equal(row!.computedCents, 7_000, "the calculated default is 7 × €10");
  assert.equal(row!.overrideCents, 5_000);
  assert.equal(row!.allowanceCents, 5_000, "the override replaces the default");
  assert.equal(budget.estimated, false);
});

test("weekly allowance: with no override the calculated default is used and spending this week is summed", () => {
  const document: FinanceDocument = {
    schemaVersion: 1,
    categories: [{ id: "groceries", name: "Groceries", kind: "flexible" }],
    transactions: [
      { id: "t1", categoryId: "groceries", kind: "expense", amountCents: 1_200, date: "2026-10-14", note: "", fixed: false, source: "manual", createdAt: "", updatedAt: "" },
      { id: "t2", categoryId: "groceries", kind: "expense", amountCents: 800, date: "2026-09-30", note: "", fixed: false, source: "manual", createdAt: "", updatedAt: "" }
    ],
    targets: [{ categoryId: "groceries", weeklyCents: 0, monthlyCents: 31_000 }],
    settings: { openingBalanceCents: 0 }
  };
  const budget = weeklyAllowanceBudget(document, "2026-10-14");
  const row = budget.rows.find((entry) => entry.categoryId === "groceries")!;
  assert.equal(row.overrideCents, null);
  assert.equal(row.allowanceCents, 7_000);
  assert.equal(row.spentCents, 1_200, "only the in-week transaction counts; 30 Sep is outside the week");
  assert.equal(row.remainingCents, 5_800);
});
