import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { monthBudget, weeklyAllowanceBudget } from "../src/dashboard/budget.js";
import type { FinanceDocument } from "../src/dashboard/finance.js";
import { openFinance, withTempDir } from "./dashboard-helpers.js";

// Fixtures only — constructed documents and a written finance.json, never the live store.

function twoCategoryDoc(snacksSpreadWeekly: boolean): FinanceDocument {
  return {
    schemaVersion: 1,
    categories: [
      { id: "groceries", name: "Groceries", kind: "flexible", spreadWeekly: true },
      { id: "snacks", name: "Snacks", kind: "flexible", spreadWeekly: snacksSpreadWeekly }
    ],
    transactions: [
      { id: "g1", categoryId: "groceries", kind: "expense", amountCents: 1_000, date: "2026-10-14", note: "", fixed: false, source: "manual", createdAt: "", updatedAt: "" },
      { id: "s1", categoryId: "snacks", kind: "expense", amountCents: 2_000, date: "2026-10-14", note: "", fixed: false, source: "manual", createdAt: "", updatedAt: "" }
    ],
    targets: [
      { categoryId: "groceries", weeklyCents: 0, monthlyCents: 31_000 },
      { categoryId: "snacks", weeklyCents: 0, monthlyCents: 31_000 }
    ],
    settings: { openingBalanceCents: 0 }
  };
}

test("spread over week: a category with spreadWeekly=false has no weekly allowance or weekly spent and is left out of the weekly total", () => {
  const budget = weeklyAllowanceBudget(twoCategoryDoc(false), "2026-10-14");
  assert.deepEqual(budget.rows.map((row) => row.categoryId), ["groceries"], "Snacks is excluded from the weekly rows");
  assert.equal(budget.allowanceCents, 7_000, "only Groceries (€310/31 × 7) counts in the weekly allowance total");
  assert.equal(budget.spentCents, 1_000, "only Groceries' in-week spending counts in the weekly spent total");
});

test("spread over week: switching it off does not change the category's monthly figures", () => {
  const off = monthBudget(twoCategoryDoc(false), "2026-10");
  const on = monthBudget(twoCategoryDoc(true), "2026-10");
  const snacksOff = off.rows.find((row) => row.categoryId === "snacks")!;
  const snacksOn = on.rows.find((row) => row.categoryId === "snacks")!;
  assert.deepEqual(
    [snacksOff.targetCents, snacksOff.spentCents, snacksOff.remainingCents],
    [snacksOn.targetCents, snacksOn.spentCents, snacksOn.remainingCents],
    "Snacks' monthly limit, spent and left are the same whether or not it spreads weekly"
  );
  assert.equal(snacksOff.spentCents, 2_000);
  assert.equal(off.spentCents, on.spentCents, "the month total is unaffected");
});

test("spread over week: when it is on (default) the category is included in the weekly figures", () => {
  const budget = weeklyAllowanceBudget(twoCategoryDoc(true), "2026-10-14");
  assert.deepEqual(budget.rows.map((row) => row.categoryId), ["groceries", "snacks"]);
  assert.equal(budget.allowanceCents, 14_000, "both categories count");
  assert.equal(budget.spentCents, 3_000);
});

test("spread over week: a stored category with no spreadWeekly field is read as true and counts weekly", async () => {
  await withTempDir(async (directory) => {
    const file = join(directory, "finance", "finance.json");
    await mkdir(join(directory, "finance"), { recursive: true });
    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      categories: [{ id: "groceries", name: "Groceries", kind: "flexible" }], // no spreadWeekly field
      transactions: [],
      targets: [{ categoryId: "groceries", weeklyCents: 0, monthlyCents: 31_000 }],
      settings: { openingBalanceCents: 0 }
    }), "utf8");
    const finance = openFinance(directory);
    const categories = await finance.listCategories();
    assert.equal(categories[0]!.spreadWeekly, true, "missing field counts as true");
    const budget = weeklyAllowanceBudget(await finance.store.read(), "2026-10-14");
    assert.deepEqual(budget.rows.map((row) => row.categoryId), ["groceries"], "it is included in the weekly figures");
  });
});
