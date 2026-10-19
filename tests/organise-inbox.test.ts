import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundError } from "../src/dashboard/errors.js";
import type { OrganiseItem } from "../src/dashboard/organise/model.js";
import type { OrganiseService } from "../src/dashboard/organise/service.js";
import { withServer, withTempDir } from "./dashboard-helpers.js";
import { openOrganise } from "./organise-helpers.js";

async function addList(organise: OrganiseService, name: string, statuses: string[]): Promise<string> {
  return organise.lists.update((document) => {
    const id = `list-${document.lists.length + 1}`;
    document.lists.push({ id, name, statuses, created_at: "", updated_at: "" });
    return id;
  });
}

test("inbox: adding takes only text, trims it, and the count follows", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const first = await organise.addToInbox({ text: "  call mum about Sunday  " });
    assert.deepEqual([first.type, first.title, first.status, first.date], ["inbox", "call mum about Sunday", null, null]);
    await organise.addToInbox({ text: "buy stamps" });
    assert.deepEqual((await organise.inbox()).count, 2);
    await assert.rejects(organise.addToInbox({ text: "   " }), /text must be 1 to 200 characters/);
    await assert.rejects(organise.addToInbox({ text: "x".repeat(201) }), /text must be 1 to 200 characters/);
    await assert.rejects(organise.addToInbox({ text: "x", type: "task" }), /Unknown field/);
    await organise.deleteItem(first.id);
    assert.deepEqual((await organise.inbox()).items.map((item) => item.title), ["buy stamps"]);
  });
});

test("sort to task keeps the id and creation time, changes the type and applies the form", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const project = await organise.createItem({ type: "project", title: "Home" });
    const captured = await organise.addToInbox({ text: "fix the shelf" });
    const task = await organise.sortInbox(captured.id, { type: "task", date: "2026-10-16", priority: "high", project_id: project.id, checklist: [{ text: "buy screws" }, { text: "drill" }] });
    assert.deepEqual([task.id, task.created_at, task.type, task.title, task.status], [captured.id, captured.created_at, "task", "fix the shelf", "open"]);
    assert.deepEqual([task.date, task.priority, task.project_id, task.checklist?.map((entry) => [entry.text, entry.done])], ["2026-10-16", "high", project.id, [["buy screws", false], ["drill", false]]]);
    assert.equal((await organise.inbox()).count, 0);
    const renamed = await organise.sortInbox((await organise.addToInbox({ text: "x" })).id, { type: "task", title: "A better title" });
    assert.equal(renamed.title, "A better title");
  });
});

test("sort to reminder, note and list item", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const reminder = await organise.sortInbox((await organise.addToInbox({ text: "Anna birthday" })).id, { type: "reminder", date: "2026-12-01", category: "Personal", recurrence: "yearly", notes: "Book table" });
    assert.deepEqual([reminder.type, reminder.date, reminder.category, reminder.recurrence, reminder.notes, reminder.status], ["reminder", "2026-12-01", "Personal", "yearly", "Book table", "open"]);
    const custom = await organise.sortInbox((await organise.addToInbox({ text: "water plants" })).id, { type: "reminder", date: "2026-10-15", recurrence: "custom", interval_days: 3, prepare_by: "2026-10-14" });
    assert.deepEqual([custom.interval_days, custom.prepare_by], [3, "2026-10-14"]);
    const note = await organise.sortInbox((await organise.addToInbox({ text: "wifi password" })).id, { type: "note", text: "Router is in the hall", link: reminder.id, date: "2026-10-14" });
    assert.deepEqual([note.type, note.title, note.notes, note.links, note.date, note.status], ["note", "wifi password", "Router is in the hall", [reminder.id], "2026-10-14", null]);
    const books = await addList(organise, "Books", ["to read", "reading", "finished"]);
    const listItem = await organise.sortInbox((await organise.addToInbox({ text: "Dune" })).id, { type: "list_item", list_id: books, status: "reading", notes: "from Sam" });
    assert.deepEqual([listItem.type, listItem.title, listItem.list_id, listItem.status, listItem.notes, listItem.done_at], ["list_item", "Dune", books, "reading", "from Sam", null]);
    const finished = await organise.sortInbox((await organise.addToInbox({ text: "Emma" })).id, { type: "list_item", list_id: books });
    assert.equal(finished.status, "to read", "a list item starts at its list's first status");
  });
});

test("sort form validation: target type, fields per form, values, only inbox items, unknown ids", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const captured = await organise.addToInbox({ text: "something" });
    await assert.rejects(organise.sortInbox(captured.id, { type: "project" }), /type must be one of: task, reminder, note, list_item/);
    await assert.rejects(organise.sortInbox(captured.id, { type: "inbox" }), /type must be one of/);
    await assert.rejects(organise.sortInbox(captured.id, { type: "reminder", date: "2026-10-20", priority: "high" }), /Unknown field\(s\): priority/);
    await assert.rejects(organise.sortInbox(captured.id, { type: "task", category: "Work" }), /Unknown field\(s\): category/);
    await assert.rejects(organise.sortInbox(captured.id, { type: "note", title: "x" }), /Unknown field\(s\): title/);
    await assert.rejects(organise.sortInbox(captured.id, { type: "list_item", list_id: "nope" }), /list_id nope is not an existing list/);
    await assert.rejects(organise.sortInbox(captured.id, { type: "reminder" }), /A reminder needs a date/);
    await assert.rejects(organise.sortInbox(captured.id, { type: "task", priority: "urgent" }), /priority must be one of/);
    await assert.rejects(organise.sortInbox(captured.id, { type: "note", link: "missing" }), /links: missing is not an existing item/);
    assert.equal((await organise.getItem(captured.id)).type, "inbox", "failed sorts change nothing");
    const task = await organise.sortInbox(captured.id, { type: "task" });
    await assert.rejects(organise.sortInbox(task.id, { type: "note" }), /Only inbox items can be sorted/);
    await assert.rejects(organise.sortInbox("missing", { type: "task" }), NotFoundError);
  });
});

test("routes: inbox add, list with count, sort and delete over HTTP", async () => {
  await withServer("2026-10-14", async ({ call }) => {
    const added = await call<OrganiseItem>("POST", "/api/organise/inbox", { text: "book flights" });
    assert.equal(added.status, 201);
    await call("POST", "/api/organise/inbox", { text: "renew insurance" });
    assert.equal((await call<{ count: number }>("GET", "/api/organise/inbox")).body.count, 2);
    const sorted = await call<OrganiseItem>("POST", `/api/organise/inbox/${added.body.id}/sort`, { type: "task", date: "2026-10-20" });
    assert.deepEqual([sorted.status, sorted.body.id, sorted.body.type], [200, added.body.id, "task"]);
    assert.equal((await call("POST", `/api/organise/inbox/${added.body.id}/sort`, { type: "note" })).status, 400);
    assert.equal((await call("POST", "/api/organise/inbox/missing/sort", { type: "task" })).status, 404);
    assert.equal((await call("POST", "/api/organise/inbox", { text: "" })).status, 400);
    const remaining = (await call<{ count: number; items: OrganiseItem[] }>("GET", "/api/organise/inbox")).body;
    assert.equal(remaining.count, 1);
    assert.equal((await call("DELETE", `/api/organise/items/${remaining.items[0]!.id}`)).status, 204);
    assert.equal((await call<{ count: number }>("GET", "/api/organise/inbox")).body.count, 0);
    assert.deepEqual((await call<unknown[]>("GET", "/api/organise/lists")).body, []);
  });
});
