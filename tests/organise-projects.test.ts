import assert from "node:assert/strict";
import test from "node:test";
import type { OrganiseItem } from "../src/dashboard/organise/model.js";
import type { ProjectPage } from "../src/dashboard/organise/projects.js";
import { withServer, withTempDir } from "./dashboard-helpers.js";
import { openOrganise } from "./organise-helpers.js";

test("project page: sections for tasks, reminders, notes, trackers and lists, open items first", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const project = await organise.createItem({ type: "project", title: "Move house", notes: "Flat by December" });
    const other = await organise.createItem({ type: "project", title: "Other" });
    const doneTask = await organise.createItem({ type: "task", title: "a done task", project_id: project.id });
    await organise.updateItem(doneTask.id, { status: "done" });
    await organise.createItem({ type: "task", title: "pack books", project_id: project.id, date: "2026-10-20" });
    await organise.createItem({ type: "task", title: "book van", project_id: project.id, date: "2026-10-16" });
    await organise.createItem({ type: "task", title: "not mine", project_id: other.id });
    const reminder = await organise.createItem({ type: "reminder", title: "landlord visit", date: "2026-10-18", project_id: project.id });
    const doneReminder = await organise.createItem({ type: "reminder", title: "deposit paid", date: "2026-10-01", project_id: project.id });
    await organise.updateItem(doneReminder.id, { status: "done" });
    await organise.createItem({ type: "note", title: "Address", notes: "New street 1", project_id: project.id });
    const list = await organise.createList({ name: "Boxes" });
    await organise.createItem({ type: "list_item", list_id: list.id, title: "kitchen", project_id: project.id, status: "done" });
    await organise.createItem({ type: "list_item", list_id: list.id, title: "bedroom", project_id: project.id });
    const page = await organise.projectPage(project.id);
    assert.equal(page.project.title, "Move house");
    assert.deepEqual(page.sections.tasks.map((item) => item.title), ["book van", "pack books", "a done task"], "open first, by due date; done last");
    assert.deepEqual(page.sections.reminders.map((item) => item.title), [reminder.title, "deposit paid"]);
    assert.deepEqual(page.sections.notes.map((item) => item.title), ["Address"]);
    assert.deepEqual(page.sections.trackers, []);
    assert.deepEqual(page.sections.lists.map((entry) => [entry.list.name, entry.rows.map((row) => row.title)]), [["Boxes", ["bedroom", "kitchen"]]], "a row on the last status counts as done");
    assert.deepEqual(page.counts, { open: 4, total: 7 });
    await assert.rejects(organise.projectPage(reminder.id), /Unknown project id/);
  });
});

test("project on tasks and reminders at creation or edit; status active, paused, done", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const project = await organise.createItem({ type: "project", title: "Kitchen" });
    const task = await organise.createItem({ type: "task", title: "measure" });
    assert.equal((await organise.updateItem(task.id, { project_id: project.id })).project_id, project.id);
    assert.equal((await organise.updateItem(task.id, { project_id: null })).project_id, null, "unassigning");
    const reminder = await organise.createItem({ type: "reminder", title: "delivery", date: "2026-10-20", project_id: project.id });
    assert.equal(reminder.project_id, project.id);
    assert.equal((await organise.updateItem(project.id, { status: "paused" })).status, "paused");
    const done = await organise.updateItem(project.id, { status: "done" });
    assert.notEqual(done.done_at, null);
    await assert.rejects(organise.updateItem(project.id, { status: "open" }), /status must be one of: active, paused, done/);
  });
});

test("deleting a project is refused while anything belongs to it, and allowed once it is empty", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory);
    const project = await organise.createItem({ type: "project", title: "Garden" });
    const task = await organise.createItem({ type: "task", title: "mow", project_id: project.id });
    const note = await organise.createItem({ type: "note", title: "seeds", project_id: project.id });
    await assert.rejects(organise.deleteItem(project.id), /Cannot delete project Garden: 2 item\(s\) still belong to it/);
    await organise.updateItem(task.id, { project_id: null });
    await organise.deleteItem(note.id);
    await organise.deleteItem(project.id);
    assert.equal((await organise.listItems({ type: "project" })).length, 0);
    assert.equal((await organise.getItem(task.id)).project_id, null);
  });
});

test("routes: project page over HTTP, 404 for unknown or non-project ids, 400 when deleting a project in use", async () => {
  await withServer("2026-10-14", async ({ call }) => {
    const project = (await call<OrganiseItem>("POST", "/api/organise/items", { type: "project", title: "Trip" })).body;
    const task = (await call<OrganiseItem>("POST", "/api/organise/items", { type: "task", title: "book hotel", project_id: project.id })).body;
    const page = await call<ProjectPage>("GET", `/api/organise/projects/${project.id}`);
    assert.deepEqual([page.status, page.body.sections.tasks.map((item) => item.id)], [200, [task.id]]);
    assert.equal((await call("GET", "/api/organise/projects/missing")).status, 404);
    assert.equal((await call("GET", `/api/organise/projects/${task.id}`)).status, 404);
    assert.equal((await call("DELETE", `/api/organise/items/${project.id}`)).status, 400);
    await call("DELETE", `/api/organise/items/${task.id}`);
    assert.equal((await call("DELETE", `/api/organise/items/${project.id}`)).status, 204);
  });
});
