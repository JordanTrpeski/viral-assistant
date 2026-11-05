// Budget status is shared by the server (budget.ts) and the browser UI (finance.ts), so it lives under
// shared/, which the dashboard serves as a browser module. No imports, so it is safe in both places.

/** The status of one category's monthly spending against its limit. "none" means no limit is set (limit ≤ 0). */
export type BudgetStatus =
  | { kind: "none" }
  | { kind: "ok" }
  | { kind: "over"; overByCents: number };

/** Status for a monthly limit and the amount spent. Spending exactly at the limit is OK; above it is over. */
export function budgetStatus(limitCents: number, spentCents: number): BudgetStatus {
  if (limitCents <= 0) return { kind: "none" };
  if (spentCents <= limitCents) return { kind: "ok" };
  return { kind: "over", overByCents: spentCents - limitCents };
}
