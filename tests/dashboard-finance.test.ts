import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { monthBudget, proratedWeeklyTarget, weekBudget } from "../src/dashboard/budget.js";
import { validateDashboardConfig } from "../src/dashboard/config.js";
import type { Category, Transaction } from "../src/dashboard/finance.js";
import { financeSummary } from "../src/dashboard/summary.js";
import { openFinance, rawRequest, withServer, withTempDir } from "./dashboard-helpers.js";

test("summary: balance, income and spent this month count only transactions dated today or earlier", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory, "2026-11-15");
    await finance.updateSettings({ openingBalanceCents: 100_000 });
    await finance.createTransaction({ categoryId: "salary", amountCents: 250_000, date: "2026-11-01" });
    await finance.createTransaction({ categoryId: "rent", amountCents: 90_000, date: "2026-11-03" });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 4_567, date: "2026-11-10" });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 1_001, date: "2026-10-20" });
    await finance.createTransaction({ categoryId: "phone", amountCents: 2_500, date: "2026-11-28" });
    const summary = financeSummary(await finance.snapshot(), "2026-11", "2026-11-15");
    assert.equal(summary.balanceCents, 100_000 + 250_000 - 90_000 - 4_567 - 1_001);
    assert.equal(summary.incomeCents, 250_000);
    assert.equal(summary.spentCents, 94_567, "October spending and the future phone bill are excluded");
    const october = financeSummary(await finance.snapshot(), "2026-10", "2026-11-15");
    assert.equal(october.spentCents, 1_001);
    assert.equal(october.incomeCents, 0);
  });
});

test("summary: runway divides the balance by the 90-day average daily spend, in whole days", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory, "2026-11-15");
    assert.equal(financeSummary(await finance.snapshot(), "2026-11", "2026-11-15").runway.days, null, "no spending means no runway estimate");
    await finance.updateSettings({ openingBalanceCents: 900_000 });
    await finance.createTransaction({ categoryId: "rent", amountCents: 270_000, date: "2026-11-15" });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 50_000, date: "2026-08-18" });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 99_999, date: "2026-08-17" });
    const summary = financeSummary(await finance.snapshot(), "2026-11", "2026-11-15");
    // Window is 2026-08-18 .. 2026-11-15 (90 days); the 2026-08-17 expense is outside it but still reduces the balance.
    assert.equal(summary.runway.windowDays, 90);
    assert.equal(summary.balanceCents, 900_000 - 270_000 - 50_000 - 99_999);
    assert.equal(summary.runway.averageDailySpendCents, Math.round(320_000 / 90));
    assert.equal(summary.runway.days, Math.floor((480_001 * 90) / 320_000));
    await finance.updateSettings({ openingBalanceCents: 0 });
    assert.equal(financeSummary(await finance.snapshot(), "2026-11", "2026-11-15").runway.days, 0, "a negative balance has zero runway");
  });
});

test("summary: editing a past transaction recalculates that month live", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory, "2026-11-15");
    const old = await finance.createTransaction({ categoryId: "groceries", amountCents: 1_000, date: "2026-10-05" });
    assert.equal(financeSummary(await finance.snapshot(), "2026-10", "2026-11-15").spentCents, 1_000);
    await finance.updateTransaction(old.id, { amountCents: 1_234 });
    assert.equal(financeSummary(await finance.snapshot(), "2026-10", "2026-11-15").spentCents, 1_234);
  });
});

test("budget: prorated weekly targets round to the cent", () => {
  assert.equal(proratedWeeklyTarget(10_000, 7), 10_000);
  assert.equal(proratedWeeklyTarget(10_000, 1), 1_429);
  assert.equal(proratedWeeklyTarget(10_000, 6), 8_571);
  assert.equal(proratedWeeklyTarget(0, 3), 0);
});

test("budget: this week is Monday to Sunday cut at month edges, counting only flexible spending inside it", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory, "2026-11-01");
    await finance.setTarget("groceries", { weeklyCents: 7_000, monthlyCents: 30_000 });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 1_500, date: "2026-11-01" });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 900, date: "2026-10-31" });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 2_000, date: "2026-11-02" });
    await finance.createTransaction({ categoryId: "rent", amountCents: 90_000, date: "2026-11-01" });
    const document = await finance.snapshot();

    const sunday = weekBudget(document, "2026-11-01");
    assert.deepEqual([sunday.start, sunday.end, sunday.days], ["2026-11-01", "2026-11-01", 1], "Sunday 1 November is a one-day week");
    const groceries = sunday.rows.find((row) => row.categoryId === "groceries")!;
    assert.deepEqual([groceries.spentCents, groceries.targetCents, groceries.configuredCents, groceries.remainingCents], [1_500, 1_000, 7_000, -500]);
    assert.equal(sunday.spentCents, 1_500, "rent is a fixed bill and never counts in a week");

    const monday = weekBudget(document, "2026-11-04");
    assert.deepEqual([monday.start, monday.end, monday.days], ["2026-11-02", "2026-11-08", 7]);
    assert.equal(monday.rows.find((row) => row.categoryId === "groceries")!.spentCents, 2_000);

    const october = weekBudget(document, "2026-10-31");
    assert.deepEqual([october.start, october.end, october.days], ["2026-10-26", "2026-10-31", 6]);
    assert.equal(october.spentCents, 900);
  });
});

test("budget: this month commits every fixed bill with its due date and counts flexible spending against monthly targets", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory, "2026-11-10");
    await finance.setTarget("groceries", { monthlyCents: 30_000 });
    await finance.setTarget("transport", { monthlyCents: 5_000 });
    await finance.createTransaction({ categoryId: "phone", amountCents: 2_500, date: "2026-11-28", note: "Phone plan" });
    await finance.createTransaction({ categoryId: "rent", amountCents: 90_000, date: "2026-11-01" });
    await finance.createTransaction({ categoryId: "rent", amountCents: 90_000, date: "2026-12-01" });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 12_345, date: "2026-11-09" });
    await finance.createTransaction({ categoryId: "transport", amountCents: 6_000, date: "2026-11-30" });
    const month = monthBudget(await finance.snapshot(), "2026-11");
    assert.deepEqual(month.committed.map((bill) => [bill.date, bill.label, bill.amountCents]), [["2026-11-01", "Rent", 90_000], ["2026-11-28", "Phone plan", 2_500]]);
    assert.equal(month.committedCents, 92_500);
    assert.deepEqual(month.rows.map((row) => [row.categoryId, row.spentCents, row.targetCents, row.remainingCents]), [
      ["groceries", 12_345, 30_000, 17_655], ["entertainment", 0, 0, 0], ["transport", 6_000, 5_000, -1_000]
    ]);
    assert.deepEqual([month.targetCents, month.spentCents, month.remainingCents], [35_000, 18_345, 16_655]);
  });
});

test("config: the dashboard only binds to loopback and validates the budget step", () => {
  assert.deepEqual(validateDashboardConfig(undefined), { host: "127.0.0.1", port: 4174, budgetStepCents: 1_000, chatMaxAmountCents: 500_000, model: "qwen3:4b-instruct", timeoutMs: 30_000, proposerEnabled: true });
  assert.throws(() => validateDashboardConfig({ chatMaxAmountCents: 0 }), /chatMaxAmountCents/);
  assert.throws(() => validateDashboardConfig({ timeoutMs: 10 }), /timeoutMs/);
  assert.throws(() => validateDashboardConfig({ proposerEnabled: "yes" }), /proposerEnabled/);
  assert.equal(validateDashboardConfig({ host: "::1", port: 0 }).host, "::1");
  assert.throws(() => validateDashboardConfig({ host: "0.0.0.0" }), /loopback/);
  assert.throws(() => validateDashboardConfig({ budgetStepCents: 0 }), /budgetStepCents/);
  assert.throws(() => validateDashboardConfig({ port: 70_000 }), /port/);
});

test("routes: transactions support create, read, edit and delete over HTTP and persist atomically", async () => {
  await withServer("2026-11-15", async ({ call, directory }) => {
    const created = await call<Transaction>("POST", "/api/finance/transactions", { categoryId: "groceries", amountCents: 2_350, date: "2026-11-14", note: "Market" });
    assert.equal(created.status, 201);
    assert.equal(created.body.kind, "expense");
    const read = await call<Transaction>("GET", `/api/finance/transactions/${created.body.id}`);
    assert.deepEqual(read.body, created.body);
    const edited = await call<Transaction>("PATCH", `/api/finance/transactions/${created.body.id}`, { amountCents: 2_400 });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.amountCents, 2_400);
    const listed = await call<Transaction[]>("GET", "/api/finance/transactions?month=2026-11&type=flexible");
    assert.equal(listed.body.length, 1);
    assert.deepEqual(await readdir(join(directory, "finance")), ["finance.json"], "no temp files after writes");
    const onDisk = JSON.parse(await readFile(join(directory, "finance", "finance.json"), "utf8")) as { transactions: Transaction[] };
    assert.equal(onDisk.transactions[0]?.amountCents, 2_400);
    assert.equal((await call("DELETE", `/api/finance/transactions/${created.body.id}`)).status, 204);
    assert.equal((await call("GET", `/api/finance/transactions/${created.body.id}`)).status, 404);
  });
});

test("routes: validation failures return 400 with a clear message, unknown ids 404", async () => {
  await withServer("2026-11-15", async ({ call }) => {
    const zero = await call<{ error: string }>("POST", "/api/finance/transactions", { categoryId: "groceries", amountCents: 0, date: "2026-11-14" });
    assert.equal(zero.status, 400);
    assert.match(zero.body.error, /positive whole number of cents/);
    const unknownCategory = await call<{ error: string }>("POST", "/api/finance/transactions", { categoryId: "yachts", amountCents: 10, date: "2026-11-14" });
    assert.equal(unknownCategory.status, 400);
    assert.match(unknownCategory.body.error, /Unknown category: yachts/);
    assert.equal((await call("GET", "/api/finance/transactions?month=November")).status, 400);
    assert.equal((await call("GET", "/api/finance/transactions?type=sometimes")).status, 400);
    assert.equal((await call("GET", "/api/budget?date=2026-02-30")).status, 400);
    const missing = await call<{ error: string }>("PATCH", "/api/finance/transactions/nope", { note: "x" });
    assert.equal(missing.status, 404);
    assert.match(missing.body.error, /Unknown transaction id: nope/);
    assert.equal((await call("DELETE", "/api/finance/categories/nope")).status, 404);
    assert.equal((await call("PATCH", "/api/finance/targets/nope", { weeklyCents: 1 })).status, 404);
    assert.equal((await call("GET", "/api/finance/unknown")).status, 404);
    assert.equal((await call("PUT", "/api/finance/transactions")).status, 405);
  });
});

test("routes: non-JSON bodies, malformed JSON and non-loopback Host headers are refused", async () => {
  await withServer("2026-11-15", async ({ server }) => {
    const form = await rawRequest(server.port, { method: "POST", path: "/api/finance/transactions", headers: { "content-type": "application/x-www-form-urlencoded", host: `127.0.0.1:${server.port}` }, body: "a=1" });
    assert.equal(form.status, 415);
    const malformed = await rawRequest(server.port, { method: "POST", path: "/api/finance/transactions", headers: { "content-type": "application/json", host: `127.0.0.1:${server.port}` }, body: "{oops" });
    assert.equal(malformed.status, 400);
    assert.match(malformed.text, /valid JSON/);
    const rebinding = await rawRequest(server.port, { path: "/api/status", headers: { host: "evil.example:4174" } });
    assert.equal(rebinding.status, 403);
    const localhost = await rawRequest(server.port, { path: "/api/status", headers: { host: `localhost:${server.port}` } });
    assert.equal(localhost.status, 200);
  });
});

test("routes: categories, targets with the configured step, settings, summary and budget", async () => {
  await withServer("2026-11-15", async ({ call }) => {
    const category = await call<Category>("POST", "/api/finance/categories", { name: "Dining out", kind: "flexible" });
    assert.equal(category.status, 201);
    assert.equal((await call("POST", "/api/finance/categories", { name: "Dining out", kind: "flexible" })).status, 400);
    assert.equal((await call<Category>("PATCH", `/api/finance/categories/${category.body.id}`, { name: "Restaurants" })).body.name, "Restaurants");
    const stepped = await call<{ weeklyCents: number }>("POST", `/api/finance/targets/${category.body.id}/step`, { period: "weekly", direction: 1 });
    assert.equal(stepped.status, 200);
    assert.equal(stepped.body.weeklyCents, 2_500, "uses the configured 25 EUR step in this test");
    assert.equal((await call("DELETE", `/api/finance/categories/${category.body.id}`)).status, 204);

    assert.deepEqual((await call("PATCH", "/api/settings", { openingBalanceCents: 50_000 })).body, { openingBalanceCents: 50_000, budgetStepCents: 2_500 });
    await call("POST", "/api/finance/transactions", { categoryId: "salary", amountCents: 100_000, date: "2026-11-01" });
    const summary = await call<{ balanceCents: number; incomeCents: number }>("GET", "/api/finance/summary");
    assert.deepEqual([summary.body.balanceCents, summary.body.incomeCents], [150_000, 100_000]);
    const budget = await call<{ date: string; stepCents: number; week: { start: string }; month: { month: string } }>("GET", "/api/budget");
    assert.deepEqual([budget.body.date, budget.body.stepCents, budget.body.week.start, budget.body.month.month], ["2026-11-15", 2_500, "2026-11-09", "2026-11"]);
    const status = await call<{ daemon: string; tokensToday: null; today: string }>("GET", "/api/status");
    assert.deepEqual([status.body.daemon, status.body.tokensToday, status.body.today], ["online", null, "2026-11-15"]);
  }, 2_500);
});

test("routes: the page, stylesheet and compiled browser modules are served; nothing else is", async () => {
  await withServer("2026-11-15", async ({ call, server }) => {
    const page = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await page.text(), /\/assets\/ui\/app\.js/);
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/styles.css`)).status, 200);
    const script = await fetch(`http://127.0.0.1:${server.port}/assets/shared/money.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /javascript/);
    assert.equal((await call("GET", "/assets/ui/../../server.js")).status, 404);
    assert.equal((await call("GET", "/package.json")).status, 404);
  });
});
