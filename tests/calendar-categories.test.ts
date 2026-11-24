import assert from "node:assert/strict";
import test from "node:test";
import { withCalendar } from "./calendar-helpers.js";

test("categories: create with subcategories and default lead times", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const study = await service.createCategory({ name: "Study", subcategories: [{ name: "Exams" }], defaultLeadTimes: [1, 7] });
    assert.equal(study.name, "Study");
    assert.equal(study.colour, null);
    assert.equal(study.subcategories.length, 1);
    assert.deepEqual(study.defaultLeadTimes, [1, 7]);
    assert.equal((await service.listCategories()).length, 1);
  });
});

test("categories: deleting a category is refused while items use it, and the error names the count", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const work = await service.createCategory({ name: "Work" });
    await service.createItem({ kind: "task", title: "Report", date: "2026-03-02", categoryId: work.id });
    await service.createItem({ kind: "task", title: "Email", date: "2026-03-03", categoryId: work.id });
    await assert.rejects(service.deleteCategory(work.id), /Cannot delete Work: 2 item\(s\) use it/);
    assert.equal((await service.listCategories()).length, 1, "the category is kept");
  });
});

test("categories: move-items-and-delete moves every item to the chosen category and subcategory, then deletes the empty one", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    const admin = await service.createCategory({ name: "Admin" });
    const home = await service.createCategory({ name: "Home", subcategories: [{ name: "Bills" }] });
    const bills = home.subcategories[0]!.id;
    await service.createItem({ kind: "task", title: "Tax", date: "2026-03-05", categoryId: admin.id });
    const result = await service.moveItemsAndDeleteCategory(admin.id, { categoryId: home.id, subcategoryId: bills });
    assert.equal(result.moved, 1);
    assert.equal((await service.listCategories()).some((category) => category.id === admin.id), false, "Admin is gone");
    const moved = (await service.listItems())[0]!;
    assert.deepEqual([moved.categoryId, moved.subcategoryId], [home.id, bills]);
  });
});

test("categories: items without a category are returned as the No category group with a count", async () => {
  await withCalendar("2026-03-01", async ({ service }) => {
    await service.createItem({ kind: "task", title: "Loose one", date: "2026-03-02" });
    await service.createItem({ kind: "reminder", title: "Loose two", date: "2026-03-03" });
    const none = await service.noCategory();
    assert.equal(none.count, 2);
    assert.deepEqual(none.items.map((item) => item.title).sort(), ["Loose one", "Loose two"]);
  });
});
