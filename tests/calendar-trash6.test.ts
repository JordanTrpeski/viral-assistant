import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CalendarService } from "../src/dashboard/calendar/service.js";

async function service(now: { value: Date }): Promise<{ service: CalendarService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "viral-trash6-"));
  return { service: new CalendarService(join(dir, "store.json"), { clock: () => now.value }), dir };
}

test("trash: deleting a deadline moves it to the Deleted list (reason app), then Restore puts it back", async () => {
  const now = { value: new Date("2027-01-01T00:00:00.000Z") };
  const { service: calendar, dir } = await service(now);
  try {
    const item = await calendar.createItem({ kind: "task", title: "Tax return", date: "2027-02-10", time: "09:00" });
    await calendar.deleteItem(item.id);
    assert.equal((await calendar.listItems()).length, 0, "the item leaves the live list");
    const trash = await calendar.listTrash();
    assert.deepEqual([trash.length, trash[0]!.reason], [1, "app"]);

    await calendar.restore(trash[0]!.id);
    assert.ok((await calendar.listItems()).some((restored) => restored.id === item.id), "Restore puts the item back");
    assert.equal((await calendar.listTrash()).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("trash: an entry purges after 7 days (settings.trashDays)", async () => {
  const now = { value: new Date("2027-01-01T00:00:00.000Z") };
  const { service: calendar, dir } = await service(now);
  try {
    const item = await calendar.createItem({ kind: "reminder", title: "Dentist", date: "2027-02-10", time: "09:00" });
    await calendar.deleteItem(item.id);
    assert.equal((await calendar.listTrash()).length, 1);

    now.value = new Date("2027-01-09T00:00:00.000Z"); // 8 days later
    await calendar.purgeExpired();
    assert.equal((await calendar.listTrash()).length, 0, "the entry is gone after its 7-day window");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("trash: a conflict loser is added directly with reason conflict and is restorable", async () => {
  const now = { value: new Date("2027-01-01T00:00:00.000Z") };
  const { service: calendar, dir } = await service(now);
  try {
    const item = await calendar.createItem({ kind: "task", title: "Loser", date: "2027-02-10", time: "09:00" });
    const entry = await calendar.trashItem(item, "conflict");
    const trash = await calendar.listTrash();
    assert.deepEqual([trash.length, trash[0]!.reason], [1, "conflict"]);
    assert.equal((await calendar.restore(entry.id)).title, "Loser");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("trash: Delete now removes one entry immediately", async () => {
  const now = { value: new Date("2027-01-01T00:00:00.000Z") };
  const { service: calendar, dir } = await service(now);
  try {
    const item = await calendar.createItem({ kind: "task", title: "Gone", date: "2027-02-10", time: "09:00" });
    await calendar.deleteItem(item.id);
    const [entry] = await calendar.listTrash();
    await calendar.deleteNow(entry!.id);
    assert.equal((await calendar.listTrash()).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
