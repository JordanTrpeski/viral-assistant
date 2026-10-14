import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { CalendarMonth } from "../src/dashboard/calendar.js";
import { NotFoundError, ValidationError } from "../src/dashboard/errors.js";
import type { ReminderPanelItem } from "../src/dashboard/overview.js";
import { defaultPrepareBy, reminderTimelineItems, RemindersService, type Reminder } from "../src/dashboard/reminders.js";
import type { StoreFileSystem } from "../src/dashboard/store.js";
import type { TimelineItem } from "../src/dashboard/timeline.js";
import { clockAt, withServer, withTempDir } from "./dashboard-helpers.js";

function open(directory: string, fs?: StoreFileSystem): RemindersService {
  return RemindersService.open(join(directory, "dashboard"), { clock: clockAt("2026-11-15"), ...(fs ? { fs } : {}) });
}

test("reminders: create, read, edit, tick done and delete, persisted across reopen", async () => {
  await withTempDir(async (directory) => {
    const reminders = open(directory);
    const created = await reminders.create({ title: "Call the bank", date: "2026-11-20" });
    assert.deepEqual([created.category, created.prepareBy, created.done], ["reminder", null, false]);
    assert.deepEqual(await reminders.get(created.id), created);
    const edited = await reminders.update(created.id, { title: "Call the bank about fees", done: true, category: "viral" });
    assert.deepEqual([edited.title, edited.done, edited.category], ["Call the bank about fees", true, "viral"]);
    assert.equal((await open(directory).get(created.id)).title, "Call the bank about fees");
    await reminders.delete(created.id);
    assert.deepEqual(await reminders.list(), []);
    assert.deepEqual(await readdir(join(directory, "dashboard")), ["reminders.json"], "atomic write leaves no temp files");
  });
});

test("reminders: personal dates default prepare-by to 14 days before, which follows date changes unless customised", async () => {
  await withTempDir(async (directory) => {
    const reminders = open(directory);
    assert.equal(defaultPrepareBy("2026-12-01"), "2026-11-17");
    const birthday = await reminders.create({ title: "Anna's birthday", date: "2026-12-01", category: "personal" });
    assert.equal(birthday.prepareBy, "2026-11-17");
    assert.equal((await reminders.update(birthday.id, { date: "2026-12-10" })).prepareBy, "2026-11-26", "the default moves with the date");
    assert.equal((await reminders.update(birthday.id, { prepareBy: "2026-12-05" })).prepareBy, "2026-12-05");
    assert.equal((await reminders.update(birthday.id, { date: "2026-12-20" })).prepareBy, "2026-12-05", "a custom prepare-by stays put");
    await assert.rejects(reminders.update(birthday.id, { date: "2026-12-01" }), /prepareBy must be on or before/);
    assert.equal((await reminders.get(birthday.id)).date, "2026-12-20", "the rejected edit changed nothing");
    assert.equal((await reminders.update(birthday.id, { prepareBy: null })).prepareBy, null);
    const none = await reminders.create({ title: "Wedding", date: "2027-06-01", category: "personal", prepareBy: null });
    assert.equal(none.prepareBy, null, "an explicit null means no prepare-by");
    const plain = await reminders.create({ title: "Dentist", date: "2026-12-01" });
    assert.equal((await reminders.update(plain.id, { category: "personal" })).prepareBy, "2026-11-17", "switching to Personal adds the default");
  });
});

test("reminders: validation failures and unknown ids", async () => {
  await withTempDir(async (directory) => {
    const reminders = open(directory);
    await assert.rejects(reminders.create({ title: "", date: "2026-11-20" }), /title must be a non-empty string/);
    await assert.rejects(reminders.create({ title: "X", date: "2026-11-31" }), /valid date/);
    await assert.rejects(reminders.create({ title: "X", date: "2026-11-20", category: "boats" }), /category must be one of/);
    await assert.rejects(reminders.create({ title: "X", date: "2026-11-20", prepareBy: "2026-11-21" }), /on or before/);
    await assert.rejects(reminders.create({ title: "X", date: "2026-11-20", priority: "high" }), /Unknown field/);
    const created = await reminders.create({ title: "X", date: "2026-11-20" });
    await assert.rejects(reminders.update(created.id, { done: "yes" }), ValidationError);
    await assert.rejects(reminders.get("missing"), NotFoundError);
    await assert.rejects(reminders.update("missing", { done: true }), NotFoundError);
    await assert.rejects(reminders.delete("missing"), NotFoundError);
    await assert.rejects(reminders.list("later" as never), /status must be one of/);
  });
});

test("reminders: a failed write keeps the previous file and state", async () => {
  await withTempDir(async (directory) => {
    let fail = false;
    const fs: StoreFileSystem = {
      readFile: nodeFs.readFile, writeFile: nodeFs.writeFile, mkdir: nodeFs.mkdir, unlink: nodeFs.unlink,
      rename: async (from, to) => { if (fail) throw new Error("disk full"); await nodeFs.rename(from, to); }
    };
    const reminders = open(directory, fs);
    const kept = await reminders.create({ title: "Keep", date: "2026-11-20" });
    fail = true;
    await assert.rejects(reminders.update(kept.id, { title: "Lost" }), /disk full/);
    assert.equal((await reminders.get(kept.id)).title, "Keep");
    assert.equal((await open(directory).get(kept.id)).title, "Keep");
  });
});

test("reminders: list filters open and done, ordered by date; timeline items carry colour, status and prepare-by", async () => {
  await withTempDir(async (directory) => {
    const reminders = open(directory);
    const later = await reminders.create({ title: "Later", date: "2026-12-01", category: "gym" });
    const sooner = await reminders.create({ title: "Sooner", date: "2026-11-16", category: "personal" });
    await reminders.update(later.id, { done: true });
    assert.deepEqual((await reminders.list("open")).map((reminder) => reminder.title), ["Sooner"]);
    assert.deepEqual((await reminders.list("done")).map((reminder) => reminder.title), ["Later"]);
    assert.deepEqual((await reminders.list()).map((reminder) => reminder.title), ["Sooner", "Later"]);
    const items = reminderTimelineItems(await reminders.list());
    assert.deepEqual(items.map((entry) => [entry.id, entry.colour, entry.status, entry.prepareBy, entry.amountCents]), [
      [`reminder:${sooner.id}`, "personal", "scheduled", "2026-11-02", null], [`reminder:${later.id}`, "gym", "done", null, null]
    ]);
  });
});

test("routes: reminders flow into the calendar, Next 7 days and the Overview Reminders panel, and leave it when done", async () => {
  await withServer("2026-11-15", async ({ call }) => {
    const birthday = await call<Reminder>("POST", "/api/reminders", { title: "Anna's birthday", date: "2026-11-29", category: "personal" });
    assert.equal(birthday.status, 201);
    assert.equal(birthday.body.prepareBy, "2026-11-15");
    const overdue = await call<Reminder>("POST", "/api/reminders", { title: "Renew passport", date: "2026-11-10" });
    await call("POST", "/api/reminders", { title: "Gym check-in", date: "2026-11-17", category: "gym" });

    const calendar = (await call<CalendarMonth>("GET", "/api/calendar?month=2026-11")).body;
    const day = (date: string) => calendar.weeks.flat().find((entry) => entry.date === date)!;
    assert.deepEqual(day("2026-11-29").visible.map((entry) => [entry.label, entry.colour]), [["Anna's birthday", "personal"]]);
    assert.deepEqual(day("2026-11-15").visible.map((entry) => [entry.label, entry.colour]), [["Prepare: Anna's birthday", "reminder"]]);
    assert.equal(calendar.legend.find((entry) => entry.category === "personal")?.count, 1);

    const next = (await call<{ items: TimelineItem[] }>("GET", "/api/timeline?days=7")).body.items;
    assert.deepEqual(next.map((entry) => entry.label), ["Prepare: Anna's birthday", "Gym check-in"]);

    let panel = (await call<{ reminders: ReminderPanelItem[] }>("GET", "/api/overview")).body.reminders;
    assert.deepEqual(panel.map((entry) => [entry.label, entry.overdue]), [["Renew passport", true], ["Prepare: Anna's birthday", false], ["Gym check-in", false], ["Anna's birthday", false]]);

    await call("PATCH", `/api/reminders/${overdue.body.id}`, { done: true });
    await call("PATCH", `/api/reminders/${birthday.body.id}`, { done: true });
    panel = (await call<{ reminders: ReminderPanelItem[] }>("GET", "/api/overview")).body.reminders;
    assert.deepEqual(panel.map((entry) => entry.label), ["Gym check-in"], "done reminders and their preparation leave the panel");

    assert.equal((await call<Reminder[]>("GET", "/api/reminders?status=done")).body.length, 2);
    assert.equal((await call("GET", "/api/reminders?status=soon")).status, 400);
    assert.equal((await call("POST", "/api/reminders", { title: "X", date: "2026-11-20", prepareBy: "2026-12-01" })).status, 400);
    assert.equal((await call("PATCH", "/api/reminders/missing", { done: true })).status, 404);
    assert.equal((await call("DELETE", `/api/reminders/${birthday.body.id}`)).status, 204);
    assert.equal((await call("GET", `/api/reminders/${birthday.body.id}`)).status, 404);
    const after = (await call<CalendarMonth>("GET", "/api/calendar?month=2026-11")).body;
    assert.equal(after.weeks.flat().find((entry) => entry.date === "2026-11-15")?.items.length, 0, "deleting removes the prepare-by entry too");
  });
});
