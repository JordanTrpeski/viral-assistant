import assert from "node:assert/strict";
import test from "node:test";
import { exportColumns, type OverviewPanels, type SearchResult, type TodayStrip } from "../src/dashboard/organise/overview.js";
import type { OrganiseItem } from "../src/dashboard/organise/model.js";
import { rawRequest, withServer, withTempDir } from "./dashboard-helpers.js";
import { openOrganise } from "./organise-helpers.js";

// 2026-10-14 is a Wednesday.
const today = "2026-10-14";

test("search matches title, notes, checklist text and project name, case-insensitively, grouped by type", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const kitchen = await organise.createItem({ type: "project", title: "Kitchen refit" });
    await organise.createItem({ type: "task", title: "Order worktop" });
    await organise.createItem({ type: "task", title: "Measure", checklist: [{ text: "check the WORKTOP depth" }] });
    await organise.createItem({ type: "note", title: "Supplier", notes: "Oak worktop from Timber & Co" });
    await organise.createItem({ type: "reminder", title: "Delivery", date: "2026-10-20", project_id: kitchen.id });
    await organise.createItem({ type: "task", title: "Unrelated" });
    const worktop = await organise.search("worktop");
    assert.equal(worktop.total, 3);
    assert.deepEqual(Object.fromEntries(Object.entries(worktop.groups).map(([type, items]) => [type, items!.map((item) => item.title)])), { task: ["Measure", "Order worktop"], note: ["Supplier"] });
    const byProject = await organise.search("KITCHEN");
    assert.deepEqual(Object.fromEntries(Object.entries(byProject.groups).map(([type, items]) => [type, items!.map((item) => item.title)])), { reminder: ["Delivery"], project: ["Kitchen refit"] }, "matches the project's name for its items");
    assert.deepEqual(await organise.search("   "), { q: "", total: 0, groups: {} });
    await assert.rejects(organise.search("x".repeat(201)), /q must be at most 200 characters/);
  });
});

test("filter combinations across type, project, status and date range", async () => {
  await withServer(today, async ({ call }) => {
    const home = (await call<OrganiseItem>("POST", "/api/organise/items", { type: "project", title: "Home" })).body;
    const make = (body: Record<string, unknown>) => call<OrganiseItem>("POST", "/api/organise/items", body);
    await make({ type: "task", title: "t-home-open", project_id: home.id, date: "2026-10-15" });
    const doneTask = (await make({ type: "task", title: "t-home-done", project_id: home.id, date: "2026-10-16" })).body;
    await call("PATCH", `/api/organise/items/${doneTask.id}`, { status: "done" });
    await make({ type: "task", title: "t-free", date: "2026-10-15" });
    await make({ type: "reminder", title: "r-home", project_id: home.id, date: "2026-10-15" });
    const titles = async (query: string) => (await call<OrganiseItem[]>("GET", `/api/organise/items?${query}`)).body.map((item) => item.title).sort();
    assert.deepEqual(await titles(`project_id=${home.id}`), ["r-home", "t-home-done", "t-home-open"]);
    assert.deepEqual(await titles(`type=task&project_id=${home.id}`), ["t-home-done", "t-home-open"]);
    assert.deepEqual(await titles(`type=task&project_id=${home.id}&status=open`), ["t-home-open"]);
    assert.deepEqual(await titles("type=task&from=2026-10-15&to=2026-10-15"), ["t-free", "t-home-open"]);
    assert.deepEqual(await titles(`status=open&from=2026-10-15&to=2026-10-15&project_id=${home.id}`), ["r-home", "t-home-open"]);
    assert.deepEqual(await titles("type=task&status=done&to=2026-10-15"), []);
    assert.equal((await call("GET", "/api/organise/items?from=2026-10-20&to=2026-10-01")).status, 400);
  });
});

test("Today strip: open tasks due today or overdue, open reminders today or overdue, and reminders to prepare for now", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    await organise.createItem({ type: "task", title: "task overdue", date: "2026-10-12" });
    await organise.createItem({ type: "task", title: "task today", date: today });
    await organise.createItem({ type: "task", title: "task tomorrow", date: "2026-10-15" });
    const done = await organise.createItem({ type: "task", title: "task done", date: today });
    await organise.updateItem(done.id, { status: "done" });
    await organise.createItem({ type: "reminder", title: "reminder overdue", date: "2026-10-13" });
    await organise.createItem({ type: "reminder", title: "reminder today", date: today });
    await organise.createItem({ type: "reminder", title: "birthday", date: "2026-10-25", category: "Personal" });
    await organise.createItem({ type: "reminder", title: "later birthday", date: "2026-11-30", category: "Personal" });
    const strip: TodayStrip = await organise.todayView();
    assert.deepEqual(strip.tasks.map((item) => [item.title, item.overdue]), [["task overdue", true], ["task today", false]]);
    assert.deepEqual(strip.reminders.map((item) => [item.title, item.overdue]), [["reminder overdue", true], ["reminder today", false]]);
    assert.deepEqual(strip.prepare.map((item) => [item.title, item.prepare_by]), [["birthday", "2026-10-11"]], "prepare_by on or before today, event still to come");
  });
});

test("export: UTF-8 BOM, header row, every field quoted with quotes doubled, CRLF, formulas neutralised", async () => {
  await withServer(today, async ({ call, server }) => {
    const project = (await call<OrganiseItem>("POST", "/api/organise/items", { type: "project", title: "Home, sweet \"home\"" })).body;
    await call("POST", "/api/organise/items", { type: "task", title: "=SUM(A1:A2)", notes: "line one\nline two", project_id: project.id, checklist: [{ text: "a", done: true }, { text: "b" }] });
    const response = await rawRequest(server.port, { path: "/api/organise/export.csv", headers: { host: `127.0.0.1:${server.port}` } });
    assert.equal(response.status, 200);
    assert.match(String(response.headers["content-type"]), /text\/csv; charset=utf-8/);
    assert.match(String(response.headers["content-disposition"]), /attachment; filename="organise-export.csv"/);
    assert.equal(response.text.charCodeAt(0), 0xfeff, "starts with a byte-order mark");
    const lines = response.text.slice(1).split("\r\n");
    assert.equal(lines[0], exportColumns.map((column) => `"${column}"`).join(","));
    assert.equal(lines.at(-1), "", "ends with CRLF");
    const body = response.text.slice(1);
    assert.ok(body.includes("\"Home, sweet \"\"home\"\"\""), "commas and quotes are escaped");
    assert.ok(body.includes("\"'=SUM(A1:A2)\""), "a formula-looking title gets a leading apostrophe");
    assert.ok(body.includes("\"line one\nline two\""), "newlines stay inside quoted fields");
    assert.ok(body.includes("\"[x] a; [ ] b\""), "checklist exported as text");
    assert.equal(lines.filter((line) => line.startsWith("\"") && /^"[0-9a-f-]{36}"/.test(line)).length, 2, "one row per item");
  });
});

test("Overview counts: tasks, reminders for 30 days with prepare entries, notes and lists, trackers", async () => {
  await withServer(today, async ({ call }) => {
    const post = (body: Record<string, unknown>) => call<OrganiseItem>("POST", "/api/organise/items", body);
    await post({ type: "task", title: "overdue", date: "2026-10-10" });
    await post({ type: "task", title: "today", date: today });
    await post({ type: "task", title: "day 6", date: "2026-10-20" });
    await post({ type: "task", title: "day 7", date: "2026-10-21" });
    await post({ type: "task", title: "undated" });
    await post({ type: "reminder", title: "Anna", date: "2026-10-30", category: "Personal" });
    await post({ type: "reminder", title: "too far", date: "2026-11-20" });
    await post({ type: "note", title: "n1" });
    const list = (await call<{ id: string }>("POST", "/api/organise/lists", { name: "Books", preset: "books" })).body;
    await post({ type: "list_item", list_id: list.id, title: "Dune", status: "finished" });
    await post({ type: "list_item", list_id: list.id, title: "Emma" });
    await call("POST", "/api/organise/trackers", { name: "Run", unit: "km", target: 20, period: "weekly" });
    const overview = (await call<OverviewPanels & { today: TodayStrip }>("GET", "/api/organise/overview")).body;
    assert.deepEqual(overview.tasks, { open: 5, dueThisWeek: 2, overdue: 1 });
    assert.deepEqual(overview.reminders.map((entry) => [entry.date, entry.label]), [["2026-10-16", "Prepare: Anna"], ["2026-10-30", "Anna"]],
      "30 days ahead with prepare entries; 2026-11-20 is beyond 2026-11-13 and Other reminders get no prepare-by");
    assert.deepEqual(overview.notesAndLists, { notes: 1, lists: 1, rows: 2, openRows: 1 });
    assert.deepEqual(overview.trackers.map((tracker) => [tracker.name, tracker.progress.total, tracker.progress.target]), [["Run", 0, 20]]);
    assert.deepEqual(overview.today.tasks.map((task) => task.title), ["overdue", "today"]);
    const result = (await call<SearchResult>("GET", "/api/organise/search?q=ann")).body;
    assert.deepEqual(result.groups.reminder?.map((item) => item.title), ["Anna"]);
  });
});
