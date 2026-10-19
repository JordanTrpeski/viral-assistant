import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NotFoundError, ValidationError } from "../src/dashboard/errors.js";
import type { OrganiseItem } from "../src/dashboard/organise/model.js";
import type { StoreFileSystem } from "../src/dashboard/store.js";
import { withServer, withTempDir } from "./dashboard-helpers.js";
import { openOrganise } from "./organise-helpers.js";

test("items: create, read, edit and delete, persisted atomically across reopen", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const task = await organise.createItem({ type: "task", title: "  Renew passport  ", date: "2026-10-20" });
    assert.deepEqual([task.type, task.title, task.status, task.priority, task.checklist, task.notes, task.links, task.done_at], ["task", "Renew passport", "open", "normal", [], "", [], null]);
    assert.deepEqual([task.recurrence, task.category, task.list_id], [null, null, null], "fields of other types stay empty");
    assert.deepEqual(await organise.getItem(task.id), task);
    const edited = await organise.updateItem(task.id, { title: "Renew passport online", priority: "high", notes: "Photo needed" });
    assert.deepEqual([edited.title, edited.priority, edited.notes, edited.date], ["Renew passport online", "high", "Photo needed", "2026-10-20"]);
    assert.equal((await openOrganise(directory).getItem(task.id)).title, "Renew passport online", "persists across reopen");
    assert.deepEqual(await readdir(join(directory, "organise")), ["items.json"], "atomic write leaves no temp files");
    const onDisk = JSON.parse(await readFile(join(directory, "organise", "items.json"), "utf8")) as { schemaVersion: number; items: OrganiseItem[] };
    assert.deepEqual([onDisk.schemaVersion, onDisk.items.length], [1, 1]);
    await organise.deleteItem(task.id);
    assert.deepEqual(await organise.listItems(), []);
  });
});

test("items: a failed write keeps the previous file and in-memory state", async () => {
  await withTempDir(async (directory) => {
    let fail = false;
    const fs: StoreFileSystem = {
      readFile: nodeFs.readFile, writeFile: nodeFs.writeFile, mkdir: nodeFs.mkdir, unlink: nodeFs.unlink,
      rename: async (from, to) => { if (fail) throw new Error("disk full"); await nodeFs.rename(from, to); }
    };
    const organise = openOrganise(directory, "2026-10-14", { fs });
    const kept = await organise.createItem({ type: "task", title: "Kept" });
    fail = true;
    await assert.rejects(organise.updateItem(kept.id, { title: "Lost" }), /disk full/);
    assert.equal((await organise.getItem(kept.id)).title, "Kept");
    assert.equal((await openOrganise(directory).getItem(kept.id)).title, "Kept");
    assert.deepEqual(await readdir(join(directory, "organise")), ["items.json"]);
  });
});

test("validation: title length, type enum, unknown fields, type-only fields", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    await assert.rejects(organise.createItem({ type: "task", title: "" }), /title must be 1 to 200 characters/);
    await assert.rejects(organise.createItem({ type: "task", title: "x".repeat(201) }), /title must be 1 to 200 characters/);
    assert.equal((await organise.createItem({ type: "task", title: "x".repeat(200) })).title.length, 200);
    await assert.rejects(organise.createItem({ type: "project", title: "x".repeat(101) }), /name must be 1 to 100 characters/);
    await assert.rejects(organise.createItem({ type: "event", title: "x" }), /type must be one of: task, reminder, note, list_item, project, inbox/);
    await assert.rejects(organise.createItem({ title: "no type" }), /type must be one of/);
    await assert.rejects(organise.createItem({ type: "task", title: "x", colour: "red" }), /Unknown field/);
    await assert.rejects(organise.createItem({ type: "task", title: "x", category: "Work" }), /category only applies to reminders, not tasks/);
    await assert.rejects(organise.createItem({ type: "reminder", title: "x", date: "2026-10-20", priority: "high" }), /priority only applies to tasks/);
    await assert.rejects(organise.createItem({ type: "note", title: "x", checklist: [{ text: "a" }] }), /checklist only applies to tasks/);
    await assert.rejects(organise.createItem({ type: "task", title: "x", list_id: "abc" }), /list_id only applies to list items/);
    await assert.rejects(organise.createItem({ type: "task", title: "x", notes: "n".repeat(5_001) }), /notes must be at most 5000 characters/);
    await assert.rejects(organise.createItem({ type: "task", title: "x", priority: "urgent" }), /priority must be one of: low, normal, high/);
    await assert.rejects(organise.createItem({ type: "task", title: "x", checklist: [{ text: "" }] }), /checklist\[0\]\.text must be 1 to 200/);
    await assert.rejects(organise.createItem("nope"), ValidationError);
  });
});

test("validation: dates, prepare_by order, reminder requirements and recurrence", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    await assert.rejects(organise.createItem({ type: "task", title: "x", date: "2026-02-30" }), /date must be a valid date/);
    await assert.rejects(organise.createItem({ type: "reminder", title: "x" }), /A reminder needs a date/);
    await assert.rejects(organise.createItem({ type: "reminder", title: "x", date: "2026-10-20", prepare_by: "2026-10-21" }), /prepare_by must be on or before date/);
    await assert.rejects(organise.createItem({ type: "task", title: "x", prepare_by: "2026-10-21" }), /prepare_by needs a date/);
    const sameDay = await organise.createItem({ type: "reminder", title: "x", date: "2026-10-20", prepare_by: "2026-10-20" });
    assert.equal(sameDay.prepare_by, "2026-10-20", "prepare_by on the same day is allowed");
    await assert.rejects(organise.createItem({ type: "reminder", title: "x", date: "2026-10-20", recurrence: "monthly" }), /recurrence must be one of: none, yearly, custom/);
    await assert.rejects(organise.createItem({ type: "reminder", title: "x", date: "2026-10-20", recurrence: "custom" }), /interval_days must be a whole number from 1 to 365/);
    await assert.rejects(organise.createItem({ type: "reminder", title: "x", date: "2026-10-20", recurrence: "custom", interval_days: 366 }), /interval_days/);
    await assert.rejects(organise.createItem({ type: "reminder", title: "x", date: "2026-10-20", recurrence: "yearly", interval_days: 7 }), /only applies to custom recurrence/);
    await assert.rejects(organise.createItem({ type: "reminder", title: "x", date: "2026-10-20", category: "Fun" }), /category must be one of: Personal, Bill, Study, Work, Health, Other/);
    const custom = await organise.createItem({ type: "reminder", title: "Water plants", date: "2026-10-20", recurrence: "custom", interval_days: 3 });
    assert.deepEqual([custom.recurrence, custom.interval_days, custom.category, custom.status], ["custom", 3, "Other", "open"]);
  });
});

test("validation: project and link ids must exist; no self-links; notes take their title from the text", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const project = await organise.createItem({ type: "project", title: "Move house" });
    const task = await organise.createItem({ type: "task", title: "Pack books", project_id: project.id });
    assert.equal(task.project_id, project.id);
    await assert.rejects(organise.createItem({ type: "task", title: "x", project_id: "missing" }), /project_id missing is not an existing project/);
    await assert.rejects(organise.createItem({ type: "task", title: "x", project_id: task.id }), /is not an existing project/, "a task is not a project");
    await assert.rejects(organise.createItem({ type: "project", title: "Sub", project_id: project.id }), /cannot belong to another project/);
    await assert.rejects(organise.createItem({ type: "task", title: "x", links: ["missing"] }), /links: missing is not an existing item/);
    await assert.rejects(organise.updateItem(task.id, { links: [task.id] }), /cannot link to itself/);
    const note = await organise.createItem({ type: "note", notes: "Boxes from the shop\nsecond line", links: [task.id, task.id] });
    assert.deepEqual([note.title, note.links, note.status], ["Boxes from the shop", [task.id], null], "links are de-duplicated");
    await assert.rejects(organise.createItem({ type: "note" }), /A note needs a title or some text/);
    await organise.deleteItem(task.id);
    assert.deepEqual((await organise.getItem(note.id)).links, [], "deleting an item removes it from other items' links");
  });
});

test("status rules per type, done_at set on done and cleared on reopen, type fixed on edit", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const task = await organise.createItem({ type: "task", title: "Task" });
    await assert.rejects(organise.updateItem(task.id, { status: "active" }), /status must be one of: open, in_progress, done/);
    assert.equal((await organise.updateItem(task.id, { status: "in_progress" })).done_at, null);
    const done = await organise.updateItem(task.id, { status: "done" });
    assert.match(done.done_at ?? "", /^2026-10-14T/);
    assert.equal((await organise.updateItem(task.id, { title: "Task (renamed)" })).done_at, done.done_at, "editing a done item keeps done_at");
    assert.equal((await organise.updateItem(task.id, { status: "open" })).done_at, null, "reopening clears done_at");
    const reminder = await organise.createItem({ type: "reminder", title: "R", date: "2026-10-20" });
    await assert.rejects(organise.updateItem(reminder.id, { status: "in_progress" }), /status must be one of: open, done/);
    const project = await organise.createItem({ type: "project", title: "P" });
    assert.equal(project.status, "active");
    assert.equal((await organise.updateItem(project.id, { status: "paused" })).status, "paused");
    await assert.rejects(organise.createItem({ type: "note", title: "N", status: "open" }), /notes have no status/);
    await assert.rejects(organise.createItem({ type: "inbox", title: "I", status: "open" }), /inbox items have no status/);
    await assert.rejects(organise.createItem({ type: "list_item", title: "L" }), /A list item needs a list_id/);
    await assert.rejects(organise.updateItem(task.id, { type: "reminder" }), /type cannot be changed by editing/);
  });
});

test("unknown ids raise NotFoundError", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    await assert.rejects(organise.getItem("missing"), NotFoundError);
    await assert.rejects(organise.updateItem("missing", { title: "x" }), NotFoundError);
    await assert.rejects(organise.deleteItem("missing"), NotFoundError);
  });
});

test("routes: items CRUD over HTTP with 201/200/204/400/404, and the organise UI modules are served", async () => {
  await withServer("2026-10-14", async ({ call, server, directory }) => {
    const created = await call<OrganiseItem>("POST", "/api/organise/items", { type: "task", title: "Book dentist" });
    assert.equal(created.status, 201);
    assert.equal((await call<OrganiseItem>("GET", `/api/organise/items/${created.body.id}`)).body.title, "Book dentist");
    assert.equal((await call<OrganiseItem>("PATCH", `/api/organise/items/${created.body.id}`, { status: "done" })).body.status, "done");
    assert.equal((await call<OrganiseItem[]>("GET", "/api/organise/items?type=task")).body.length, 1);
    assert.equal((await call<OrganiseItem[]>("GET", "/api/organise/items?type=note")).body.length, 0);
    assert.equal((await call("GET", "/api/organise/items?type=boat")).status, 400);
    const bad = await call<{ error: string }>("POST", "/api/organise/items", { type: "task", title: "" });
    assert.deepEqual([bad.status, bad.body.error], [400, "title must be 1 to 200 characters"]);
    assert.equal((await call("PATCH", "/api/organise/items/missing", { title: "x" })).status, 404);
    assert.equal((await call("DELETE", `/api/organise/items/${created.body.id}`)).status, 204);
    assert.equal((await call("GET", `/api/organise/items/${created.body.id}`)).status, 404);
    const vocab = await call<{ types: string[]; statuses: Record<string, string[] | null> }>("GET", "/api/organise/meta");
    assert.deepEqual(vocab.body.statuses.task, ["open", "in_progress", "done"]);
    assert.deepEqual(await readdir(join(directory, "dashboard", "organise")), ["items.json"], "stored under .viral/dashboard/organise/ (temp dir in tests)");
    const asset = await fetch(`http://127.0.0.1:${server.port}/assets/ui/organise/overview.js`);
    assert.equal(asset.status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/assets/ui/organise/../../../server.js`)).status, 404);
  });
});
