import assert from "node:assert/strict";
import test from "node:test";
import { occurrences } from "../src/dashboard/calendar/recurrence.js";
import { withCalendar } from "./calendar-helpers.js";

test("trash: deleting a one-off item moves it to trash with a 7-day expiry, and restore puts it back", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const item = await service.createItem({ kind: "task", title: "One-off", date: "2026-03-05" });
    await service.deleteItem(item.id);
    assert.equal((await service.listItems()).length, 0);
    const trash = await service.listTrash();
    assert.equal(trash.length, 1);
    assert.equal(trash[0]!.reason, "app");
    assert.equal(trash[0]!.expiresAt, new Date(Date.parse("2026-03-01T12:00:00") + 7 * 86_400_000).toISOString());
    await service.restore(trash[0]!.id);
    assert.deepEqual((await service.listItems()).map((entry) => entry.title), ["One-off"]);
  });
});

test("trash: entries older than 7 days are purged when the store is next used", async () => {
  await withCalendar("2026-03-01", async ({ service, advanceSeconds }) => {
    const item = await service.createItem({ kind: "task", title: "Old", date: "2026-03-05" });
    await service.deleteItem(item.id);
    assert.equal((await service.listTrash()).length, 1);
    advanceSeconds(7 * 86_400 + 1); // just past the 7-day window
    assert.equal((await service.listTrash()).length, 0, "purged on load");
  });
});

test("trash: recurring delete — this occurrence records a skip and makes no trash entry", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const item = await service.createItem({ kind: "task", title: "Standup", date: "2026-03-02", recurrence: { freq: "weekly" } });
    await service.deleteItem(item.id, { scope: "occurrence", occurrenceDate: "2026-03-09" });
    assert.equal((await service.listTrash()).length, 0, "no trash entry for a single occurrence");
    const after = await service.getItem(item.id);
    assert.deepEqual(after.recurrence!.skips, ["2026-03-09"]);
    assert.deepEqual(occurrences(after, "2026-03-02", "2026-03-16"), ["2026-03-02", "2026-03-16"], "9 Mar is skipped");
  });
});

test("trash: recurring delete — this and all future ends the live series and trashes the tail", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const item = await service.createItem({ kind: "task", title: "Standup", date: "2026-03-02", recurrence: { freq: "weekly" } });
    await service.deleteItem(item.id, { scope: "future", occurrenceDate: "2026-03-16" });
    const after = await service.getItem(item.id);
    assert.equal(after.recurrence!.until, "2026-03-15", "the live series ends the day before");
    assert.deepEqual(occurrences(after, "2026-03-02", "2026-04-30"), ["2026-03-02", "2026-03-09"]);
    const trash = await service.listTrash();
    assert.equal(trash.length, 1);
    assert.equal(trash[0]!.reason, "series");
    assert.equal(trash[0]!.item.recurrence!.anchor, "2026-03-16", "the trashed tail starts at the cut date");
  });
});

test("trash: recurring delete — entire series trashes the whole item", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const item = await service.createItem({ kind: "task", title: "Standup", date: "2026-03-02", recurrence: { freq: "weekly" } });
    await service.deleteItem(item.id, { scope: "series" });
    assert.equal((await service.listItems()).length, 0);
    const trash = await service.listTrash();
    assert.equal(trash.length, 1);
    assert.equal(trash[0]!.reason, "series");
  });
});

test("trash: a recurring item needs a delete scope", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const item = await service.createItem({ kind: "task", title: "Standup", date: "2026-03-02", recurrence: { freq: "weekly" } });
    await assert.rejects(service.deleteItem(item.id), /needs a delete scope/);
  });
});
