import assert from "node:assert/strict";
import test from "node:test";
import { budgetStatus } from "../src/dashboard/budget.js";

// Fixtures only — fixed limit/spent pairs, never the real finance store.

test("budget status: under the limit is OK with nothing over", () => {
  assert.deepEqual(budgetStatus(5_000, 3_000), { kind: "ok" });
});

test("budget status: exactly at the limit is OK (not over)", () => {
  assert.deepEqual(budgetStatus(5_000, 5_000), { kind: "ok" });
});

test("budget status: over the limit reports how much over, in cents", () => {
  assert.deepEqual(budgetStatus(5_000, 6_250), { kind: "over", overByCents: 1_250 });
  assert.deepEqual(budgetStatus(5_000, 5_001), { kind: "over", overByCents: 1 });
});

test("budget status: no limit set (zero or negative) shows none, so the row shows only the spent amount", () => {
  assert.deepEqual(budgetStatus(0, 3_000), { kind: "none" });
  assert.deepEqual(budgetStatus(0, 0), { kind: "none" });
  assert.deepEqual(budgetStatus(-100, 3_000), { kind: "none" });
});
