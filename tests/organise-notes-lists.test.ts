import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NotFoundError } from "../src/dashboard/errors.js";
import type { OrganiseItem } from "../src/dashboard/organise/model.js";
import type { OrganiseList } from "../src/dashboard/organise/service.js";
import { withServer, withTempDir } from "./dashboard-helpers.js";
import { movableClock, openOrganise } from "./organise-helpers.js";

test("lists: default statuses, presets as status sets, custom statuses, validation", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    assert.deepEqual((await organise.createList({ name: "Chores" })).statuses, ["to do", "doing", "done"]);
    assert.deepEqual((await organise.createList({ name: "Books", preset: "books" })).statuses, ["to read", "reading", "finished"]);
    assert.deepEqual((await organise.createList({ name: "Films", preset: "films" })).statuses, ["to watch", "watching", "watched"]);
    assert.deepEqual((await organise.createList({ name: "Ideas", statuses: [" raw ", "shaped", "used"] })).statuses, ["raw", "shaped", "used"]);
    await assert.rejects(organise.createList({ name: "x", preset: "games" }), /preset must be one of: default, books, films/);
    await assert.rejects(organise.createList({ name: "x", preset: "books", statuses: ["a"] }), /not both/);
    await assert.rejects(organise.createList({ name: "x", statuses: [] }), /statuses must be a list of 1 to 10 names/);
    await assert.rejects(organise.createList({ name: "x", statuses: ["a", "A"] }), /different from each other/);
    await assert.rejects(organise.createList({ name: "" }), /name must be 1 to 100 characters/);
    await assert.rejects(organise.createList({ name: "x", colour: "red" }), /Unknown field/);
    assert.deepEqual((await readdir(join(directory, "organise"))).sort(), ["lists.json"], "lists live in lists.json");
  });
});

test("list rows: status from their list, live changes, done_at when reaching the last status", async () => {
  await withTempDir(async (directory) => {
    const time = movableClock("2026-10-14");
    const organise = openOrganise(directory, "2026-10-14", { clock: time.clock });
    const books = await organise.createList({ name: "Books", preset: "books" });
    const dune = await organise.createItem({ type: "list_item", list_id: books.id, title: "Dune" });
    assert.deepEqual([dune.status, dune.done_at], ["to read", null]);
    await assert.rejects(organise.updateItem(dune.id, { status: "done" }), /status must be one of: to read, reading, finished/, "only its list's statuses");
    assert.equal((await organise.updateItem(dune.id, { status: "reading" })).done_at, null);
    time.advanceDays(3);
    const finished = await organise.updateItem(dune.id, { status: "finished" });
    assert.match(finished.done_at ?? "", /^2026-10-17/);
    assert.equal((await organise.updateItem(dune.id, { status: "reading" })).done_at, null, "leaving the last status clears done_at");
    await assert.rejects(organise.createItem({ type: "list_item", list_id: "missing", title: "x" }), /list_id missing is not an existing list/);
  });
});

test("list changes: rename, reorder statuses (done_at follows the new last status), no removing used statuses, delete only when empty", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const list = await organise.createList({ name: "Trips" });
    const rome = await organise.createItem({ type: "list_item", list_id: list.id, title: "Rome", status: "done" });
    const oslo = await organise.createItem({ type: "list_item", list_id: list.id, title: "Oslo", status: "doing" });
    assert.notEqual(rome.done_at, null);
    assert.equal((await organise.updateList(list.id, { name: "Trips 2027" })).name, "Trips 2027");
    await assert.rejects(organise.updateList(list.id, { statuses: ["to do", "done"] }), /Cannot remove status\(es\) still in use: doing/);
    const reordered = await organise.updateList(list.id, { statuses: ["to do", "done", "doing"] });
    assert.deepEqual(reordered.statuses, ["to do", "done", "doing"]);
    assert.equal((await organise.getItem(rome.id)).done_at, null, "done is no longer the last status");
    assert.notEqual((await organise.getItem(oslo.id)).done_at, null, "doing is now the last status");
    await assert.rejects(organise.deleteList(list.id), /Cannot delete a list with 2 row\(s\)/);
    await organise.deleteItem(rome.id);
    await organise.deleteItem(oslo.id);
    await organise.deleteList(list.id);
    await assert.rejects(organise.getList(list.id), NotFoundError);
    await assert.rejects(organise.updateList("missing", { name: "x" }), NotFoundError);
  });
});

test("notes: optional title, links to existing items only, editable links", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const project = await organise.createItem({ type: "project", title: "Kitchen" });
    const task = await organise.createItem({ type: "task", title: "Measure walls" });
    const reminder = await organise.createItem({ type: "reminder", title: "Delivery", date: "2026-10-20" });
    const note = await organise.createItem({ type: "note", notes: "Oak worktop, 3m\nmatte finish", date: "2026-10-14", links: [project.id, task.id, reminder.id] });
    assert.deepEqual([note.title, note.links.length, note.status], ["Oak worktop, 3m", 3, null]);
    await assert.rejects(organise.updateItem(note.id, { links: [...note.links, "missing"] }), /links: missing is not an existing item/);
    assert.deepEqual((await organise.updateItem(note.id, { links: [task.id] })).links, [task.id]);
    const titled = await organise.createItem({ type: "note", title: "Shopping", notes: "" });
    assert.equal(titled.title, "Shopping");
  });
});

test("routes: lists CRUD and rows over HTTP", async () => {
  await withServer("2026-10-14", async ({ call }) => {
    const created = await call<OrganiseList>("POST", "/api/organise/lists", { name: "Books", preset: "books" });
    assert.equal(created.status, 201);
    assert.equal((await call<OrganiseList[]>("GET", "/api/organise/lists")).body.length, 1);
    const row = await call<OrganiseItem>("POST", "/api/organise/items", { type: "list_item", list_id: created.body.id, title: "Dune" });
    assert.equal(row.body.status, "to read");
    assert.equal((await call<OrganiseItem>("PATCH", `/api/organise/items/${row.body.id}`, { status: "finished" })).body.done_at !== null, true);
    assert.equal((await call("PATCH", `/api/organise/lists/${created.body.id}`, { statuses: ["a"] })).status, 400);
    assert.equal((await call("DELETE", `/api/organise/lists/${created.body.id}`)).status, 400);
    assert.equal((await call("GET", "/api/organise/lists/missing")).status, 404);
    assert.equal((await call("DELETE", `/api/organise/items/${row.body.id}`)).status, 204);
    assert.equal((await call("DELETE", `/api/organise/lists/${created.body.id}`)).status, 204);
  });
});
