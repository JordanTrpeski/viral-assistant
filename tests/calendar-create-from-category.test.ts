import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CalendarService } from "../src/dashboard/calendar/service.js";
import { effectiveLeadTimes } from "../src/dashboard/calendar/reminders.js";

async function svc(): Promise<{ service: CalendarService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "viral-cfc-"));
  return { service: new CalendarService(join(dir, "store.json"), { clock: () => new Date("2027-01-01T00:00:00Z") }), dir };
}

test("create-from-category: the new-item flow records the chosen category and subcategory", async () => {
  const { service, dir } = await svc();
  try {
    const category = await service.createCategory({ name: "Health", subcategories: [{ name: "Dentist" }], defaultLeadTimes: [1, 7] });
    const sub = (await service.listCategories())[0]!.subcategories[0]!;
    const event = await service.createItem({ kind: "reminder", title: "Checkup", date: "2027-02-10", time: "09:00", categoryId: category.id, subcategoryId: sub.id });
    assert.deepEqual([event.categoryId, event.subcategoryId], [category.id, sub.id]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("create-from-category: an Event inherits the category's default lead times; a Deadline carries none", async () => {
  const { service, dir } = await svc();
  try {
    const category = await service.createCategory({ name: "Admin", defaultLeadTimes: [1, 7] });

    // Event: no explicit lead times → inherits the category default (as the Events form sends).
    const event = await service.createItem({ kind: "reminder", title: "Renew", date: "2027-02-10", time: "09:00", categoryId: category.id });
    assert.deepEqual(effectiveLeadTimes(event, category), [1, 7], "the Event takes the category's lead times");

    // Deadline: the Deadlines form sends leadTimes [] → no category reminders (Events only).
    const deadline = await service.createItem({ kind: "task", title: "File", date: "2027-02-10", time: "09:00", categoryId: category.id, leadTimes: [] });
    assert.deepEqual(effectiveLeadTimes(deadline, category), [], "the Deadline carries no lead times");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
