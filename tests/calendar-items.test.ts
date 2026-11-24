import assert from "node:assert/strict";
import test from "node:test";
import { withCalendar } from "./calendar-helpers.js";

test("items: create fills sensible defaults (open, normal, not all-day, UTC)", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const item = await service.createItem({ kind: "task", title: "Draft", date: "2026-03-10" });
    assert.equal(item.status, "open");
    assert.equal(item.priority, "normal");
    assert.equal(item.allDay, false);
    assert.equal(item.categoryId, null);
    assert.equal(item.subcategoryId, null);
    assert.equal(item.leadTimes, null);
    assert.equal(item.timeZone, "Europe/Ljubljana", "new items default to the settings time zone");
  });
});

test("items: an all-day item may not carry a time", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    await assert.rejects(service.createItem({ kind: "reminder", title: "Birthday", date: "2026-03-10", allDay: true, time: "09:00" }), /all-day item has no time/);
    const ok = await service.createItem({ kind: "reminder", title: "Birthday", date: "2026-03-10", allDay: true });
    assert.equal(ok.time, null);
  });
});

test("items: a subcategory must belong to the item's category", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const health = await service.createCategory({ name: "Health", subcategories: [{ name: "Dentist" }] });
    const other = await service.createCategory({ name: "People", subcategories: [{ name: "Family" }] });
    await assert.rejects(
      service.createItem({ kind: "task", title: "Checkup", date: "2026-03-10", categoryId: health.id, subcategoryId: other.subcategories[0]!.id }),
      /subcategory does not belong/
    );
    const ok = await service.createItem({ kind: "task", title: "Checkup", date: "2026-03-10", categoryId: health.id, subcategoryId: health.subcategories[0]!.id });
    assert.equal(ok.subcategoryId, health.subcategories[0]!.id);
  });
});

test("items: changing an item's category clears its subcategory until a new one is chosen", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const study = await service.createCategory({ name: "Study", subcategories: [{ name: "Exams" }] });
    const work = await service.createCategory({ name: "Work", subcategories: [{ name: "Meetings" }] });
    const item = await service.createItem({ kind: "task", title: "Revise", date: "2026-03-10", categoryId: study.id, subcategoryId: study.subcategories[0]!.id });

    const moved = await service.updateItem(item.id, { categoryId: work.id });
    assert.equal(moved.categoryId, work.id);
    assert.equal(moved.subcategoryId, null, "the subcategory is cleared on a category change");

    const chosen = await service.updateItem(item.id, { subcategoryId: work.subcategories[0]!.id });
    assert.equal(chosen.subcategoryId, work.subcategories[0]!.id);
  });
});
