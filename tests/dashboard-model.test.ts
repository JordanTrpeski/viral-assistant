import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NotFoundError, ValidationError } from "../src/dashboard/errors.js";
import { emptyFinanceDocument, FinanceService } from "../src/dashboard/finance.js";
import {
  addDays, addMonths, budgetWeekOf, budgetWeeksOfMonth, daysBetween, isIsoDate, lastOfMonth, monthGrid, weekdayMondayFirst
} from "../src/dashboard/shared/dates.js";
import { formatCents, parseEuroToCents, sumCents } from "../src/dashboard/shared/money.js";
import { JsonDocumentStore, type StoreFileSystem } from "../src/dashboard/store.js";
import { transactionTimelineItems } from "../src/dashboard/timeline.js";
import { openFinance, withTempDir } from "./dashboard-helpers.js";

test("money: euro input parses to integer cents and formats back without float drift", () => {
  assert.equal(parseEuroToCents("12"), 1_200);
  assert.equal(parseEuroToCents("12.5"), 1_250);
  assert.equal(parseEuroToCents("12,05"), 1_205);
  assert.equal(parseEuroToCents("€ 1 234.56"), 123_456);
  assert.equal(parseEuroToCents("-3.10"), -310);
  assert.equal(parseEuroToCents("0.1"), 10);
  for (const bad of ["", "abc", "1.234", "1..2", "12.3.4"]) assert.equal(parseEuroToCents(bad), null, bad);
  assert.equal(formatCents(123_456), "€1,234.56");
  assert.equal(formatCents(-500), "-€5.00");
  assert.equal(formatCents(7), "€0.07");
  // 0.1 + 0.2 in floats is 0.30000000000000004; in cents it is exact.
  assert.equal(sumCents([10, 20]), 30);
  assert.equal(sumCents(Array.from({ length: 10 }, () => 10)), 100);
});

test("dates: validation, arithmetic across months and leap years, Monday-first weekdays", () => {
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2028-02-29"), true);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-10-25", "2026-10-26"), 1, "DST change in Europe does not distort day counts");
  assert.equal(weekdayMondayFirst("2026-11-02"), 0);
  assert.equal(weekdayMondayFirst("2026-11-01"), 6);
  assert.equal(lastOfMonth("2028-02"), "2028-02-29");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
});

test("dates: budget weeks reset on the 1st and are cut at month end", () => {
  assert.deepEqual(budgetWeekOf("2026-11-01"), { start: "2026-11-01", end: "2026-11-01", days: 1 }, "Sunday 1 November is a one-day week");
  assert.deepEqual(budgetWeekOf("2026-11-02"), { start: "2026-11-02", end: "2026-11-08", days: 7 });
  assert.deepEqual(budgetWeekOf("2026-11-30"), { start: "2026-11-30", end: "2026-11-30", days: 1 });
  assert.deepEqual(budgetWeekOf("2026-10-29"), { start: "2026-10-26", end: "2026-10-31", days: 6 });
  const weeks = budgetWeeksOfMonth("2026-11");
  assert.equal(weeks.length, 6);
  assert.equal(weeks.reduce((total, week) => total + week.days, 0), 30);
  assert.deepEqual(weeks.map((week) => week.start), ["2026-11-01", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
  const grid = monthGrid("2026-11");
  assert.equal(grid[0]?.[0], "2026-10-26");
  assert.equal(grid.at(-1)?.[6], "2026-12-06");
  assert.ok(grid.every((row) => row.length === 7 && weekdayMondayFirst(row[0]!) === 0));
});

test("atomic write: the file is replaced via rename, and no temp files are left", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory);
    await finance.createTransaction({ categoryId: "groceries", amountCents: 1_250, date: "2026-11-10" });
    const files = await readdir(join(directory, "finance"));
    assert.deepEqual(files, ["finance.json"]);
    const saved = JSON.parse(await readFile(join(directory, "finance", "finance.json"), "utf8")) as { transactions: unknown[] };
    assert.equal(saved.transactions.length, 1);
  });
});

test("atomic write: a failed rename keeps the previous file and in-memory state, and cleans up the temp file", async () => {
  await withTempDir(async (directory) => {
    let failRename = false;
    const fs: StoreFileSystem = {
      readFile: nodeFs.readFile, writeFile: nodeFs.writeFile, mkdir: nodeFs.mkdir, unlink: nodeFs.unlink,
      rename: async (from, to) => {
        if (failRename) throw new Error("disk full");
        await nodeFs.rename(from, to);
      }
    };
    const finance = FinanceService.open(join(directory, "finance"), { fs });
    await finance.createTransaction({ categoryId: "rent", amountCents: 90_000, date: "2026-11-01" });
    failRename = true;
    await assert.rejects(finance.createTransaction({ categoryId: "rent", amountCents: 1, date: "2026-11-02" }), /disk full/);
    assert.equal((await finance.listTransactions()).length, 1, "in-memory state is unchanged after a failed write");
    assert.deepEqual(await readdir(join(directory, "finance")), ["finance.json"], "no temp file left behind");
    const reopened = FinanceService.open(join(directory, "finance"));
    assert.equal((await reopened.listTransactions()).length, 1, "file on disk still holds the previous state");
  });
});

test("store: concurrent updates are serialized and none are lost", async () => {
  await withTempDir(async (directory) => {
    const store = new JsonDocumentStore(join(directory, "counter.json"), (value) => value as { count: number }, () => ({ count: 0 }));
    await Promise.all(Array.from({ length: 20 }, () => store.update((document) => { document.count += 1; })));
    assert.equal((await store.read()).count, 20);
    assert.equal((JSON.parse(await readFile(join(directory, "counter.json"), "utf8")) as { count: number }).count, 20);
  });
});

test("store: corrupt data is reported instead of being overwritten with defaults", async () => {
  await withTempDir(async (directory) => {
    await nodeFs.mkdir(join(directory, "finance"));
    await nodeFs.writeFile(join(directory, "finance", "finance.json"), "{not json");
    await assert.rejects(openFinance(directory).listTransactions(), /Invalid data/);
  });
});

test("finance: default categories are seeded as Fixed, Flexible or Income", async () => {
  await withTempDir(async (directory) => {
    const categories = await openFinance(directory).listCategories();
    assert.deepEqual(categories.map((category) => `${category.id}:${category.kind}`),
      ["rent:fixed", "phone:fixed", "subscriptions:fixed", "groceries:flexible", "entertainment:flexible", "transport:flexible", "salary:income"]);
    assert.deepEqual(emptyFinanceDocument().transactions, []);
  });
});

test("finance: transactions can be created, read, edited and deleted, and persist across reopen", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory);
    const created = await finance.createTransaction({ categoryId: "rent", amountCents: 95_000, date: "2026-11-01", note: "November rent" });
    assert.equal(created.kind, "bill");
    assert.equal(created.fixed, true);
    assert.equal(created.source, "manual");
    assert.deepEqual(await finance.getTransaction(created.id), created);

    const edited = await finance.updateTransaction(created.id, { amountCents: 96_050, note: "Rent incl. fee" });
    assert.equal(edited.amountCents, 96_050);
    assert.equal(edited.note, "Rent incl. fee");
    assert.equal(edited.date, "2026-11-01");

    const moved = await finance.updateTransaction(created.id, { categoryId: "groceries" });
    assert.equal(moved.kind, "expense", "moving to a Flexible category makes it an expense");
    assert.equal(moved.fixed, false);

    const reopened = openFinance(directory);
    assert.equal((await reopened.getTransaction(created.id)).amountCents, 96_050);

    await finance.deleteTransaction(created.id);
    assert.equal((await finance.listTransactions()).length, 0);
  });
});

test("finance: list filters by month and by Fixed, Flexible or Income, newest first", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory);
    await finance.createTransaction({ categoryId: "rent", amountCents: 1_000, date: "2026-11-01" });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 2_000, date: "2026-11-05" });
    await finance.createTransaction({ categoryId: "salary", amountCents: 300_000, date: "2026-11-25" });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 500, date: "2026-10-30" });
    assert.deepEqual((await finance.listTransactions({ month: "2026-11" })).map((item) => item.date), ["2026-11-25", "2026-11-05", "2026-11-01"]);
    assert.equal((await finance.listTransactions({ type: "flexible" })).length, 2);
    assert.equal((await finance.listTransactions({ type: "fixed", month: "2026-11" })).length, 1);
    assert.equal((await finance.listTransactions({ type: "income" }))[0]?.kind, "income");
    await assert.rejects(finance.listTransactions({ month: "2026-13" }), ValidationError);
  });
});

test("finance: validation rejects zero, negative and fractional amounts, unknown categories, bad dates and kind mismatches", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory);
    const base = { categoryId: "groceries", amountCents: 100, date: "2026-11-01" };
    await assert.rejects(finance.createTransaction({ ...base, amountCents: 0 }), /positive whole number of cents/);
    await assert.rejects(finance.createTransaction({ ...base, amountCents: -5 }), /positive whole number of cents/);
    await assert.rejects(finance.createTransaction({ ...base, amountCents: 12.5 }), /positive whole number of cents/);
    await assert.rejects(finance.createTransaction({ ...base, categoryId: "yachts" }), /Unknown category: yachts/);
    await assert.rejects(finance.createTransaction({ ...base, date: "2026-02-30" }), /valid date/);
    await assert.rejects(finance.createTransaction({ ...base, kind: "income" }), /only takes expense/);
    await assert.rejects(finance.createTransaction({ ...base, colour: "red" }), /Unknown field/);
    await assert.rejects(finance.createTransaction("nope"), /JSON object/);
    const created = await finance.createTransaction(base);
    await assert.rejects(finance.updateTransaction(created.id, { amountCents: 0 }), ValidationError);
    assert.equal((await finance.getTransaction(created.id)).amountCents, 100, "a rejected edit changes nothing");
  });
});

test("finance: unknown ids raise NotFoundError for read, edit and delete", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory);
    await assert.rejects(finance.getTransaction("missing"), NotFoundError);
    await assert.rejects(finance.updateTransaction("missing", { note: "x" }), NotFoundError);
    await assert.rejects(finance.deleteTransaction("missing"), NotFoundError);
    await assert.rejects(finance.updateCategory("missing", { name: "x" }), NotFoundError);
    await assert.rejects(finance.deleteCategory("missing"), NotFoundError);
    await assert.rejects(finance.setTarget("missing", { weeklyCents: 1 }), NotFoundError);
  });
});

test("finance: categories are created as Fixed or Flexible (or Income), renamed, and protected while in use", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory);
    const gym = await finance.createCategory({ name: "Gym membership", kind: "fixed" });
    assert.deepEqual(gym, { id: "gym-membership", name: "Gym membership", kind: "fixed" });
    await assert.rejects(finance.createCategory({ name: "gym MEMBERSHIP", kind: "flexible" }), /already exists/);
    await assert.rejects(finance.createCategory({ name: "Cats", kind: "sometimes" }), /kind must be one of/);
    assert.equal((await finance.updateCategory(gym.id, { name: "Gym" })).name, "Gym");
    await finance.createTransaction({ categoryId: gym.id, amountCents: 3_000, date: "2026-11-03" });
    await assert.rejects(finance.updateCategory(gym.id, { kind: "flexible" }), /already has transactions/);
    await assert.rejects(finance.deleteCategory(gym.id), /1 transaction\(s\) use it/);
    const coffee = await finance.createCategory({ name: "Coffee", kind: "flexible" });
    await finance.deleteCategory(coffee.id);
    assert.equal((await finance.listCategories()).some((category) => category.id === coffee.id), false);
  });
});

test("finance: weekly and monthly targets are independent, step by the configured amount and never go below zero", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory);
    assert.deepEqual((await finance.listTargets()).map((target) => target.categoryId), ["groceries", "entertainment", "transport"]);
    await finance.setTarget("groceries", { weeklyCents: 10_000, monthlyCents: 40_000 });
    assert.deepEqual(await finance.stepTarget("groceries", { period: "weekly", direction: 1 }, 1_000), { categoryId: "groceries", weeklyCents: 11_000, monthlyCents: 40_000 });
    assert.deepEqual(await finance.stepTarget("groceries", { period: "monthly", direction: -1 }, 1_000), { categoryId: "groceries", weeklyCents: 11_000, monthlyCents: 39_000 });
    assert.equal((await finance.stepTarget("transport", { period: "weekly", direction: -1 }, 1_000)).weeklyCents, 0);
    await assert.rejects(finance.setTarget("rent", { weeklyCents: 100 }), /Flexible categories only/);
    await assert.rejects(finance.setTarget("groceries", { weeklyCents: -1 }), /zero or more/);
    await assert.rejects(finance.stepTarget("groceries", { period: "daily", direction: 1 }, 1_000), /period must be one of/);
    await assert.rejects(finance.stepTarget("groceries", { period: "weekly", direction: 2 }, 1_000), /direction must be 1 or -1/);
  });
});

test("finance: opening balance accepts zero and negative cents but not fractions", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory);
    assert.deepEqual(await finance.updateSettings({ openingBalanceCents: -2_500 }), { openingBalanceCents: -2_500 });
    await assert.rejects(finance.updateSettings({ openingBalanceCents: 1.5 }), /whole number of cents/);
  });
});

test("timeline: transactions map to Bills, Income and Spending colours with done or scheduled status", async () => {
  await withTempDir(async (directory) => {
    const finance = openFinance(directory, "2026-11-15");
    await finance.createTransaction({ categoryId: "rent", amountCents: 95_000, date: "2026-12-01" });
    await finance.createTransaction({ categoryId: "salary", amountCents: 300_000, date: "2026-11-15", note: "Pay" });
    await finance.createTransaction({ categoryId: "groceries", amountCents: 1_999, date: "2026-11-02" });
    const items = transactionTimelineItems(await finance.snapshot(), "2026-11-15");
    assert.deepEqual(items.map((item) => [item.colour, item.label, item.status, item.amountCents]), [
      ["bills", "Rent", "scheduled", 95_000],
      ["income", "Pay", "done", 300_000],
      ["spending", "Groceries", "done", 1_999]
    ]);
  });
});
