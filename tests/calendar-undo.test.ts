import assert from "node:assert/strict";
import test from "node:test";
import { withCalendar } from "./calendar-helpers.js";

test("undo: the last delete can be undone within 10 seconds", async () => {
  await withCalendar("2026-03-01", async ({ service, advanceSeconds }) => {
    const item = await service.createItem({ kind: "task", title: "Oops", date: "2026-03-05" });
    await service.deleteItem(item.id);
    assert.equal((await service.listItems()).length, 0);
    advanceSeconds(5);
    assert.equal(await service.undo(), true);
    assert.deepEqual((await service.listItems()).map((entry) => entry.title), ["Oops"]);
    assert.equal((await service.listTrash()).length, 0, "the trash entry is reversed too");
  });
});

test("undo: the last complete can be undone within 10 seconds", async () => {
  await withCalendar("2026-03-01", async ({ service, advanceSeconds }) => {
    const item = await service.createItem({ kind: "task", title: "Mark", date: "2026-03-05" });
    await service.completeItem(item.id);
    assert.equal((await service.getItem(item.id)).status, "done");
    advanceSeconds(3);
    assert.equal(await service.undo(), true);
    assert.equal((await service.getItem(item.id)).status, "open");
    assert.equal((await service.listItems()).length, 1);
  });
});

test("undo: nothing is undone after the 10-second window", async () => {
  await withCalendar("2026-03-01", async ({ service, advanceSeconds }) => {
    const item = await service.createItem({ kind: "task", title: "Gone", date: "2026-03-05" });
    await service.deleteItem(item.id);
    advanceSeconds(11);
    assert.equal(await service.undo(), false, "the window has passed");
    assert.equal((await service.listItems()).length, 0, "the delete stands");
  });
});
