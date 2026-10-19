import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { weekBudget } from "../src/dashboard/budget.js";
import { NotFoundError, ValidationError } from "../src/dashboard/errors.js";
import type { Transaction } from "../src/dashboard/finance.js";
import { financePortFor, GroceriesService, priceHistory, tripTotalCents, type GroceriesDocument, type ListItem, type Trip } from "../src/dashboard/groceries.js";
import type { StoreFileSystem } from "../src/dashboard/store.js";
import { clockAt, openFinance, withServer, withTempDir } from "./dashboard-helpers.js";

function openBoth(directory: string, today = "2026-11-15", fs?: StoreFileSystem) {
  const finance = openFinance(directory, today);
  const groceries = GroceriesService.open(join(directory, "dashboard"), financePortFor(finance), { clock: clockAt(today), ...(fs ? { fs } : {}) });
  return { finance, groceries };
}

async function buy(groceries: GroceriesService, name: string, quantity: number, unitPriceCents: number): Promise<ListItem> {
  const item = await groceries.addItem({ name, quantity, unitPriceCents });
  return groceries.updateItem(item.id, { bought: true });
}

test("trip totals: quantity × unit price summed in integer cents", () => {
  assert.equal(tripTotalCents([{ quantity: 3, unitPriceCents: 99 }, { quantity: 2, unitPriceCents: 149 }]), 595);
  assert.equal(tripTotalCents(Array.from({ length: 10 }, () => ({ quantity: 1, unitPriceCents: 10 }))), 100);
  assert.equal(tripTotalCents([]), 0);
});

test("shopping list: create, read, edit, tick bought and delete; new items reuse the latest known price", async () => {
  await withTempDir(async (directory) => {
    const { groceries } = openBoth(directory);
    const milk = await groceries.addItem({ name: "Milk", quantity: 2 });
    assert.deepEqual([milk.name, milk.quantity, milk.unitPriceCents, milk.bought], ["Milk", 2, null, false]);
    assert.equal((await groceries.listItems()).length, 1);
    const edited = await groceries.updateItem(milk.id, { name: "Oat milk", unitPriceCents: 189, bought: true });
    assert.deepEqual([edited.name, edited.unitPriceCents, edited.bought], ["Oat milk", 189, true]);
    assert.equal((await groceries.updateItem(milk.id, { unitPriceCents: null })).unitPriceCents, null, "a price can be cleared");
    await groceries.deleteItem(milk.id);
    assert.deepEqual(await groceries.listItems(), []);
    await groceries.addPrice({ item: "Bread", date: "2026-11-01", unitPriceCents: 249 });
    await groceries.addPrice({ item: "bread ", date: "2026-11-10", unitPriceCents: 279 });
    assert.equal((await groceries.addItem({ name: "BREAD" })).unitPriceCents, 279);
  });
});

test("shopping list: validation failures and unknown ids", async () => {
  await withTempDir(async (directory) => {
    const { groceries } = openBoth(directory);
    await assert.rejects(groceries.addItem({ name: "" }), /name must be a non-empty string/);
    await assert.rejects(groceries.addItem({ name: "Eggs", quantity: 0 }), /quantity must be a whole number/);
    await assert.rejects(groceries.addItem({ name: "Eggs", unitPriceCents: -5 }), /positive whole number of cents/);
    await assert.rejects(groceries.addItem({ name: "Eggs", colour: "red" }), /Unknown field/);
    const eggs = await groceries.addItem({ name: "Eggs" });
    await assert.rejects(groceries.updateItem(eggs.id, { bought: "yes" }), /bought must be true or false/);
    await assert.rejects(groceries.updateItem("missing", { bought: true }), NotFoundError);
    await assert.rejects(groceries.deleteItem("missing"), NotFoundError);
  });
});

test("templates: create, edit, delete, and Start adds items while skipping ones already waiting", async () => {
  await withTempDir(async (directory) => {
    const { groceries } = openBoth(directory);
    const template = await groceries.createTemplate({ name: "Weekly basics", items: [{ name: "Milk", quantity: 2 }, { name: "Bread" }] });
    assert.deepEqual(template.items, [{ name: "Milk", quantity: 2 }, { name: "Bread", quantity: 1 }]);
    await groceries.addItem({ name: "milk" });
    const started = await groceries.startTemplate(template.id);
    assert.deepEqual(started.added.map((item) => item.name), ["Bread"]);
    assert.deepEqual(started.skipped, ["Milk"]);
    assert.equal((await groceries.listItems()).length, 2);
    const renamed = await groceries.updateTemplate(template.id, { name: "Basics", items: [{ name: "Eggs", quantity: 12 }] });
    assert.deepEqual([renamed.name, renamed.items], ["Basics", [{ name: "Eggs", quantity: 12 }]]);
    await assert.rejects(groceries.createTemplate({ name: "Bad", items: [{ name: "X", quantity: -1 }] }), ValidationError);
    await assert.rejects(groceries.startTemplate("missing"), NotFoundError);
    await groceries.deleteTemplate(template.id);
    assert.deepEqual(await groceries.listTemplates(), []);
    await assert.rejects(groceries.deleteTemplate(template.id), NotFoundError);
  });
});

test("prices: manual entries can be added, edited and deleted; the watch lists items whose latest price changed", async () => {
  await withTempDir(async (directory) => {
    const { groceries } = openBoth(directory);
    const first = await groceries.addPrice({ item: "Coffee", date: "2026-10-01", unitPriceCents: 800 });
    await groceries.addPrice({ item: "coffee", date: "2026-11-01", unitPriceCents: 900 });
    await groceries.addPrice({ item: "Rice", date: "2026-10-01", unitPriceCents: 300 });
    await groceries.addPrice({ item: "Rice", date: "2026-11-01", unitPriceCents: 300 });
    await groceries.addPrice({ item: "Apples", date: "2026-10-01", unitPriceCents: 400 });
    await groceries.addPrice({ item: "Apples", date: "2026-11-02", unitPriceCents: 300 });
    let history = await groceries.prices();
    assert.deepEqual(history.items.map((group) => [group.item, group.entries.length]), [["Apples", 2], ["coffee", 2], ["Rice", 2]]);
    assert.deepEqual(history.watch.map((entry) => [entry.key, entry.previousCents, entry.latestCents, entry.changeCents, entry.changePercent]), [
      ["apples", 400, 300, -100, -25], ["coffee", 800, 900, 100, 12.5]
    ], "unchanged Rice is not watched; biggest change first");
    await groceries.updatePrice(first.id, { unitPriceCents: 900 });
    history = await groceries.prices();
    assert.equal(history.watch.some((entry) => entry.key === "coffee"), false, "after the edit coffee no longer changed");
    await groceries.deletePrice(first.id);
    assert.equal((await groceries.prices()).items.find((group) => group.key === "coffee")?.entries.length, 1);
    await assert.rejects(groceries.addPrice({ item: "Tea", unitPriceCents: 0 }), /positive whole number of cents/);
    await assert.rejects(groceries.updatePrice("missing", { unitPriceCents: 1 }), NotFoundError);
    assert.deepEqual(priceHistory({ schemaVersion: 1, items: [], templates: [], prices: [], trips: [] }), { items: [], watch: [] });
  });
});

test("trips: completing writes exactly one Groceries expense for the total, records prices, clears bought items and updates the budget", async () => {
  await withTempDir(async (directory) => {
    const { finance, groceries } = openBoth(directory, "2026-11-04");
    await finance.setTarget("groceries", { weeklyCents: 5_000 });
    await buy(groceries, "Apples", 3, 99);
    await buy(groceries, "Cheese", 2, 149);
    const waiting = await groceries.addItem({ name: "Flour" });
    const trip = await groceries.completeTrip({ store: "Lidl" });
    assert.deepEqual([trip.date, trip.store, trip.totalCents, trip.items.map((item) => item.lineCents)], ["2026-11-04", "Lidl", 595, [297, 298]]);

    const expenses = await finance.listTransactions();
    assert.equal(expenses.length, 1);
    assert.deepEqual([expenses[0]?.id, expenses[0]?.categoryId, expenses[0]?.amountCents, expenses[0]?.kind, expenses[0]?.source, expenses[0]?.note],
      [trip.transactionId, "groceries", 595, "expense", "groceries", "Groceries trip — Lidl"]);
    assert.deepEqual((await groceries.listItems()).map((item) => item.id), [waiting.id], "bought items leave the list; unbought stay");
    assert.deepEqual((await groceries.prices()).items.map((group) => [group.item, group.entries[0]?.unitPriceCents, group.entries[0]?.tripId]), [["Apples", 99, trip.id], ["Cheese", 149, trip.id]]);
    const week = weekBudget(await finance.snapshot(), "2026-11-04");
    assert.equal(week.rows.find((row) => row.categoryId === "groceries")?.spentCents, 595, "the Overview budget sees the trip");
  });
});

test("trips: validation — no bought items, missing prices, missing Groceries category", async () => {
  await withTempDir(async (directory) => {
    const { finance, groceries } = openBoth(directory);
    await assert.rejects(groceries.completeTrip({}), /Tick at least one bought item/);
    const unpriced = await groceries.addItem({ name: "Mystery" });
    await groceries.updateItem(unpriced.id, { bought: true });
    await assert.rejects(groceries.completeTrip({}), /Set a price for: Mystery/);
    await groceries.updateItem(unpriced.id, { unitPriceCents: 100 });
    await assert.rejects(groceries.completeTrip({ date: "2026-13-01" }), /valid date/);
    await finance.deleteCategory("groceries");
    await assert.rejects(groceries.completeTrip({}), /Flexible category named Groceries/);
    assert.equal((await finance.listTransactions()).length, 0, "nothing was written to Finance");
  });
});

test("trips: if saving the trip fails after the expense was written, the expense is rolled back", async () => {
  await withTempDir(async (directory) => {
    let failGroceries = false;
    const fs: StoreFileSystem = {
      readFile: nodeFs.readFile, writeFile: nodeFs.writeFile, mkdir: nodeFs.mkdir, unlink: nodeFs.unlink,
      rename: async (from, to) => {
        if (failGroceries) throw new Error("disk full");
        await nodeFs.rename(from, to);
      }
    };
    const { finance, groceries } = openBoth(directory, "2026-11-15", fs);
    await buy(groceries, "Apples", 1, 99);
    failGroceries = true;
    await assert.rejects(groceries.completeTrip({}), /disk full/);
    assert.equal((await finance.listTransactions()).length, 0, "the orphan expense was removed");
    assert.equal((await groceries.listItems())[0]?.bought, true, "the list is unchanged");
    assert.deepEqual(await readdir(join(directory, "dashboard")), ["groceries.json"], "no temp file left behind");
  });
});

test("trips: editing updates the linked expense; deleting removes it and the trip's prices; a trip survives its expense being deleted in Finance", async () => {
  await withTempDir(async (directory) => {
    const { finance, groceries } = openBoth(directory);
    await buy(groceries, "Apples", 2, 100);
    const trip = await groceries.completeTrip({ date: "2026-11-14" });
    const edited = await groceries.updateTrip(trip.id, { store: "Aldi", items: [{ name: "Apples", quantity: 3, unitPriceCents: 110 }] });
    assert.equal(edited.totalCents, 330);
    const expense = await finance.getTransaction(trip.transactionId!);
    assert.deepEqual([expense.amountCents, expense.note, expense.date], [330, "Groceries trip — Aldi", "2026-11-14"]);
    assert.deepEqual((await groceries.prices()).items[0]?.entries.map((entry) => entry.unitPriceCents), [110], "trip prices follow the edit");
    await assert.rejects(groceries.updateTrip(trip.id, { items: [] }), /at least one item/);
    await assert.rejects(groceries.updateTrip("missing", { store: "x" }), NotFoundError);

    await finance.deleteTransaction(trip.transactionId!);
    const orphaned = await groceries.updateTrip(trip.id, { store: "Aldi Süd" });
    assert.equal(orphaned.transactionId, null);
    await groceries.deleteTrip(trip.id);
    assert.deepEqual(await groceries.listTrips(), []);
    assert.deepEqual((await groceries.prices()).items, []);

    await buy(groceries, "Pears", 1, 250);
    const second = await groceries.completeTrip({});
    await groceries.deleteTrip(second.id);
    assert.equal((await finance.listTransactions()).length, 0, "deleting a trip deletes its expense");
    await assert.rejects(groceries.deleteTrip(second.id), NotFoundError);
  });
});

test("routes: groceries over HTTP, from list to trip to Finance and the Overview budget", async () => {
  await withServer("2026-11-04", async ({ call, directory }) => {
    const item = await call<ListItem>("POST", "/api/groceries/items", { name: "Apples", quantity: 3, unitPriceCents: 99 });
    assert.equal(item.status, 201);
    assert.equal((await call<ListItem>("PATCH", `/api/groceries/items/${item.body.id}`, { bought: true })).body.bought, true);
    const trip = await call<Trip>("POST", "/api/groceries/trips", { store: "Market" });
    assert.equal(trip.status, 201);
    assert.equal(trip.body.totalCents, 297);
    assert.equal((await call<Trip>("GET", `/api/groceries/trips/${trip.body.id}`)).body.id, trip.body.id);
    const finance = await call<Transaction[]>("GET", "/api/finance/transactions?type=flexible");
    assert.deepEqual(finance.body.map((transaction) => [transaction.amountCents, transaction.source]), [[297, "groceries"]]);
    const budget = await call<{ week: { spentCents: number } }>("GET", "/api/budget");
    assert.equal(budget.body.week.spentCents, 297);
    assert.equal((await call("POST", "/api/groceries/trips", {})).status, 400, "no bought items left");
    assert.equal((await call("PATCH", "/api/groceries/trips/missing", { store: "x" })).status, 404);
    assert.equal((await call("DELETE", "/api/groceries/templates/missing")).status, 404);
    const template = await call<{ id: string }>("POST", "/api/groceries/templates", { name: "Basics", items: [{ name: "Milk" }] });
    const started = await call<{ added: ListItem[] }>("POST", `/api/groceries/templates/${template.body.id}/start`, {});
    assert.equal(started.status, 200);
    assert.equal(started.body.added.length, 1);
    assert.equal((await call<{ watch: unknown[] }>("GET", "/api/groceries/prices")).body.watch.length, 0);
    assert.equal((await call("DELETE", `/api/groceries/trips/${trip.body.id}`)).status, 204);
    assert.equal((await call<Transaction[]>("GET", "/api/finance/transactions")).body.length, 0);
    const files = (await readdir(join(directory, "dashboard"))).sort();
    assert.deepEqual(files, ["groceries.json"]);
    const saved = JSON.parse(await nodeFs.readFile(join(directory, "dashboard", "groceries.json"), "utf8")) as GroceriesDocument;
    assert.equal(saved.items.length, 1);
  });
});
