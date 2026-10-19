import assert from "node:assert/strict";
import test from "node:test";
import { organiseModules } from "../src/dashboard/organise/modules/registry.js";
import type { OrganiseItem } from "../src/dashboard/organise/model.js";
import { matchesFilter } from "../src/dashboard/organise/service.js";
import { groupTasks, type TaskGroups } from "../src/dashboard/organise/tasks.js";
import { withServer, withTempDir } from "./dashboard-helpers.js";
import { openOrganise } from "./organise-helpers.js";

// 2026-10-14 is a Wednesday.
const today = "2026-10-14";

test("grouping boundaries: today and overdue in Today, day 1 to day 6 in This week, day 7 and undated in Later", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const make = (title: string, date: string | null) => organise.createItem({ type: "task", title, ...(date ? { date } : {}) });
    await make("overdue", "2026-10-10");
    await make("today", "2026-10-14");
    await make("day 1", "2026-10-15");
    await make("day 6", "2026-10-20");
    await make("day 7", "2026-10-21");
    await make("no date", null);
    const groups = groupTasks(await organise.listItems(), today);
    assert.deepEqual(groups.today.map((task) => [task.title, task.overdue]), [["overdue", true], ["today", false]]);
    assert.deepEqual(groups.thisWeek.map((task) => task.title), ["day 1", "day 6"]);
    assert.deepEqual(groups.later.map((task) => task.title), ["day 7", "no date"], "day 7 is Later; undated sorts last");
    assert.deepEqual(groups.done, []);
  });
});

test("complete sets done_at and moves to Done, never deleted; reopen returns it; in_progress still counts as open", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const first = await organise.createItem({ type: "task", title: "first", date: "2026-10-12" });
    const second = await organise.createItem({ type: "task", title: "second" });
    await organise.updateItem(second.id, { status: "in_progress" });
    const done = await organise.updateItem(first.id, { status: "done" });
    assert.match(done.done_at ?? "", /^2026-10-14/);
    let groups = groupTasks(await organise.listItems(), today);
    assert.deepEqual(groups.done.map((task) => [task.title, task.overdue]), [["first", false]], "a done task is not overdue");
    assert.deepEqual(groups.later.map((task) => task.title), ["second"]);
    assert.equal((await organise.listItems({ type: "task" })).length, 2, "completing never deletes");
    const reopened = await organise.updateItem(first.id, { status: "open" });
    assert.equal(reopened.done_at, null);
    groups = groupTasks(await organise.listItems(), today);
    assert.deepEqual([groups.today.map((task) => task.title), groups.done.length], [["first"], 0]);
  });
});

test("Done is ordered by newest done_at first", () => {
  const task = (title: string, doneAt: string): OrganiseItem => ({
    id: title, type: "task", title, date: null, prepare_by: null, recurrence: null, interval_days: null, category: null, project_id: null,
    status: "done", priority: "normal", notes: "", links: [], list_id: null, checklist: [], created_at: "", updated_at: "", done_at: doneAt
  });
  const groups = groupTasks([task("old", "2026-10-01T09:00:00Z"), task("new", "2026-10-13T09:00:00Z"), task("mid", "2026-10-07T09:00:00Z")], today);
  assert.deepEqual(groups.done.map((entry) => entry.title), ["new", "mid", "old"]);
});

test("priority orders tasks due the same day; checklist entries change in place with n of m progress", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    await organise.createItem({ type: "task", title: "b normal", date: today });
    await organise.createItem({ type: "task", title: "a low", date: today, priority: "low" });
    await organise.createItem({ type: "task", title: "c high", date: today, priority: "high" });
    assert.deepEqual(groupTasks(await organise.listItems(), today).today.map((task) => task.title), ["c high", "b normal", "a low"]);

    const task = await organise.createItem({ type: "task", title: "pack", checklist: [{ text: "books" }, { text: "plates" }, { text: "lamps" }] });
    const ids = task.checklist!.map((entry) => entry.id);
    assert.equal(new Set(ids).size, 3, "each entry gets its own id");
    const ticked = await organise.updateItem(task.id, { checklist: task.checklist!.map((entry, index) => ({ ...entry, done: index < 2 })) });
    assert.deepEqual(ticked.checklist!.map((entry) => entry.id), ids, "ticking keeps entry ids");
    const view = groupTasks([ticked], today).later[0]!;
    assert.deepEqual(view.progress, { done: 2, total: 3 });
    const trimmed = await organise.updateItem(task.id, { checklist: [...ticked.checklist!.slice(1), { text: "tape" }] });
    assert.deepEqual(trimmed.checklist!.map((entry) => [entry.text, entry.done]), [["plates", true], ["lamps", false], ["tape", false]]);
    assert.equal(trimmed.status, "open", "a finished checklist does not complete the task by itself");
    assert.equal((await organise.listItems({ type: "task" })).length, 4, "checklist entries are not separate items");
  });
});

test("filters: project, status and due date range, alone and combined", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const home = await organise.createItem({ type: "project", title: "Home" });
    const work = await organise.createItem({ type: "project", title: "Work" });
    await organise.createItem({ type: "task", title: "h1", project_id: home.id, date: "2026-10-15" });
    await organise.createItem({ type: "task", title: "h2", project_id: home.id, date: "2026-11-01", status: "in_progress" });
    await organise.createItem({ type: "task", title: "w1", project_id: work.id, date: "2026-10-16" });
    await organise.createItem({ type: "task", title: "loose" });
    const titles = async (filter: Parameters<typeof organise.listItems>[0]) => (await organise.listItems({ type: "task", ...filter })).map((item) => item.title);
    assert.deepEqual(await titles({ project_id: home.id }), ["h1", "h2"]);
    assert.deepEqual(await titles({ status: "in_progress" }), ["h2"]);
    assert.deepEqual(await titles({ from: "2026-10-15", to: "2026-10-16" }), ["h1", "w1"], "range is inclusive; undated tasks are excluded");
    assert.deepEqual(await titles({ project_id: home.id, from: "2026-10-20" }), ["h2"]);
    assert.deepEqual(await titles({ project_id: work.id, status: "done" }), []);
    assert.equal(matchesFilter((await organise.listItems({ type: "task" }))[3]!, {}), true);
  });
});

test("routes: grouped tasks with filters; module registry declares task actions", async () => {
  await withServer(today, async ({ call }) => {
    await call("POST", "/api/organise/items", { type: "task", title: "today", date: today });
    await call("POST", "/api/organise/items", { type: "task", title: "later", date: "2026-12-01" });
    const groups = (await call<TaskGroups>("GET", "/api/organise/tasks")).body;
    assert.deepEqual([groups.today.length, groups.thisWeek.length, groups.later.length, groups.done.length], [1, 0, 1, 0]);
    const filtered = (await call<TaskGroups>("GET", "/api/organise/tasks?from=2026-11-01&to=2026-12-31")).body;
    assert.deepEqual(filtered.later.map((task) => task.title), ["later"]);
    assert.equal((await call("GET", "/api/organise/tasks?from=2026-12-01&to=2026-11-01")).status, 400);
    assert.equal((await call("GET", "/api/organise/tasks?from=soon")).status, 400);
  });
  const tasks = organiseModules.find((module) => module.type === "task")!;
  assert.deepEqual([tasks.label, tasks.statuses], ["Tasks", ["open", "in_progress", "done"]]);
  assert.ok(tasks.actions.every((action) => action.name && action.description && action.fieldSchema));
});
