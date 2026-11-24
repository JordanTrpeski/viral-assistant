import assert from "node:assert/strict";
import test from "node:test";
import { withCalendar } from "./calendar-helpers.js";

test("reminders: a timed item with a 3-day lead fires at its own time on the day three days before", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const study = await service.createCategory({ name: "Study", defaultLeadTimes: [3] });
    await service.createItem({ kind: "reminder", title: "Exam", date: "2026-03-10", time: "08:00", categoryId: study.id });
    const reminders = await service.remindersInRange("2026-03-01", "2026-03-31");
    assert.equal(reminders.length, 1);
    assert.deepEqual([reminders[0]!.date, reminders[0]!.time, reminders[0]!.leadDays], ["2026-03-07", "08:00", 3]);
  });
});

test("reminders: an all-day item fires at the all-day reminder time (09:00), not a timed one", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const home = await service.createCategory({ name: "Home", defaultLeadTimes: [0, 1] });
    await service.createItem({ kind: "reminder", title: "Anniversary", date: "2026-03-10", allDay: true, categoryId: home.id });
    const reminders = await service.remindersInRange("2026-03-01", "2026-03-31");
    assert.deepEqual(reminders.map((reminder) => [reminder.date, reminder.time]), [
      ["2026-03-09", "09:00"], ["2026-03-10", "09:00"]
    ]);
  });
});

test("reminders: an item override replaces the category default and never adds to it", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const admin = await service.createCategory({ name: "Admin", defaultLeadTimes: [7] });
    const inherits = await service.createItem({ kind: "reminder", title: "Renew", date: "2026-03-20", time: "10:00", categoryId: admin.id });
    const overrides = await service.createItem({ kind: "reminder", title: "Pay", date: "2026-03-20", time: "10:00", categoryId: admin.id, leadTimes: [1] });
    const silenced = await service.createItem({ kind: "reminder", title: "Quiet", date: "2026-03-20", time: "10:00", categoryId: admin.id, leadTimes: [] });

    const reminders = await service.remindersInRange("2026-03-01", "2026-03-31");
    const byItem = (id: string): string[] => reminders.filter((reminder) => reminder.itemId === id).map((reminder) => reminder.date);
    assert.deepEqual(byItem(inherits.id), ["2026-03-13"], "inherits the 7-day default");
    assert.deepEqual(byItem(overrides.id), ["2026-03-19"], "override of 1 day replaces the default");
    assert.deepEqual(byItem(silenced.id), [], "an empty override silences reminders, it does not add the default");
  });
});

test("reminders: an item with no category and no override has no reminders", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    await service.createItem({ kind: "reminder", title: "Lonely", date: "2026-03-10", time: "08:00" });
    assert.deepEqual(await service.remindersInRange("2026-03-01", "2026-03-31"), []);
  });
});
