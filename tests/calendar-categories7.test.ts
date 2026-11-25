import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultCategories } from "../src/dashboard/calendar/model.js";
import { CalendarService } from "../src/dashboard/calendar/service.js";
import { ValidationError } from "../src/dashboard/errors.js";

async function svc(): Promise<{ service: CalendarService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "viral-cat7-"));
  return { service: new CalendarService(join(dir, "store.json"), { clock: () => new Date("2027-01-01T00:00:00Z") }), dir };
}

test("categories: create, rename and delete a category; add, rename and delete a subcategory", async () => {
  const { service, dir } = await svc();
  try {
    const category = await service.createCategory({ name: "Projects" });
    assert.equal((await service.renameCategory(category.id, "Side projects")).name, "Side projects");

    const sub = await service.addSubcategory(category.id, "Website");
    assert.equal((await service.renameSubcategory(category.id, sub.id, "App")).name, "App");
    await service.deleteSubcategory(category.id, sub.id);
    assert.equal((await service.listCategories())[0]!.subcategories.length, 0);

    await service.deleteCategory(category.id);
    assert.equal((await service.listCategories()).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("categories: default lead times are editable and stored on the category", async () => {
  const { service, dir } = await svc();
  try {
    const category = await service.createCategory({ name: "Admin", defaultLeadTimes: [1] });
    const updated = await service.setCategoryLeadTimes(category.id, [1, 7]);
    assert.deepEqual(updated.defaultLeadTimes, [1, 7]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("categories: deleting a category or subcategory with items is blocked (a move is required first)", async () => {
  const { service, dir } = await svc();
  try {
    const category = await service.createCategory({ name: "Work", subcategories: [{ name: "Meetings" }] });
    const sub = (await service.listCategories())[0]!.subcategories[0]!;
    await service.createItem({ kind: "task", title: "Standup", date: "2027-02-10", time: "09:00", categoryId: category.id, subcategoryId: sub.id });

    await assert.rejects(service.deleteCategory(category.id), ValidationError);
    await assert.rejects(service.deleteSubcategory(category.id, sub.id), ValidationError);
    // nothing was deleted
    assert.equal((await service.listCategories()).length, 1);
    assert.equal((await service.listCategories())[0]!.subcategories.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("categories: the default categories (with subcategories and lead times) seed only on a fresh store", async () => {
  const { service, dir } = await svc();
  try {
    assert.equal(await service.seedDefaultCategoriesIfEmpty(), true, "seeds a fresh store");
    const seeded = await service.listCategories();
    assert.equal(seeded.length, defaultCategories.length);
    const work = seeded.find((category) => category.name === "Work")!;
    assert.deepEqual(work.subcategories.map((sub) => sub.name), ["Meetings", "Deadlines", "Admin"]);
    assert.ok(work.defaultLeadTimes.length > 0, "a seeded category carries default lead times");

    // Re-run: existing categories are not touched.
    const before = JSON.stringify(await service.listCategories());
    assert.equal(await service.seedDefaultCategoriesIfEmpty(), false, "does not seed again");
    assert.equal(JSON.stringify(await service.listCategories()), before, "existing categories are unchanged");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("categories: a store that already has one category is never reseeded", async () => {
  const { service, dir } = await svc();
  try {
    await service.createCategory({ name: "Only mine" });
    assert.equal(await service.seedDefaultCategoriesIfEmpty(), false);
    assert.deepEqual((await service.listCategories()).map((category) => category.name), ["Only mine"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
