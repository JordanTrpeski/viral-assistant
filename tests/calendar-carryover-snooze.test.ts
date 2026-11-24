import assert from "node:assert/strict";
import test from "node:test";
import { localNoon, withCalendar } from "./calendar-helpers.js";

test("carry-over: open tasks due or planned before today appear in today's list, flagged overdue", async () => {
  await withCalendar("2026-03-10", async ({ service }) => {
    const overdueDue = await service.createItem({ kind: "task", title: "Late (due)", date: "2026-03-01", dueDate: "2026-03-05" });
    const overduePlanned = await service.createItem({ kind: "task", title: "Late (planned)", date: "2026-03-01", plannedDate: "2026-03-08" });
    const dueToday = await service.createItem({ kind: "task", title: "Due today", date: "2026-03-10", dueDate: "2026-03-10" });
    const future = await service.createItem({ kind: "task", title: "Later", date: "2026-03-20", dueDate: "2026-03-20" });

    const today = await service.today();
    const byId = new Map(today.map((entry) => [entry.item.id, entry.overdue]));
    assert.equal(byId.get(overdueDue.id), true);
    assert.equal(byId.get(overduePlanned.id), true);
    assert.equal(byId.get(dueToday.id), false, "due today is not overdue");
    assert.equal(byId.has(future.id), false, "a future task is not in today's list");
  });
});

test("carry-over: a completed task drops out of today's list", async () => {
  await withCalendar("2026-03-10", async ({ service }) => {
    const task = await service.createItem({ kind: "task", title: "Finish", date: "2026-03-01", dueDate: "2026-03-05" });
    assert.equal((await service.today()).length, 1);
    await service.completeItem(task.id);
    assert.equal((await service.today()).length, 0, "done tasks leave the open list");
  });
});

test("snooze: a snoozed item is skipped by reminder queries until its snooze time passes", async () => {
  await withCalendar("2026-03-01", async ({ service, setNow }) => {
    const admin = await service.createCategory({ name: "Admin", defaultLeadTimes: [0] });
    const item = await service.createItem({ kind: "reminder", title: "Renew", date: "2026-03-10", time: "08:00", categoryId: admin.id });
    assert.equal((await service.remindersInRange("2026-03-01", "2026-03-31")).length, 1);

    await service.snooze(item.id, new Date(localNoon("2026-03-05").getTime()).toISOString());
    assert.equal((await service.remindersInRange("2026-03-01", "2026-03-31")).length, 0, "snoozed: skipped");

    setNow(localNoon("2026-03-06"));
    assert.equal((await service.remindersInRange("2026-03-01", "2026-03-31")).length, 1, "after the snooze time it returns");
  });
});
