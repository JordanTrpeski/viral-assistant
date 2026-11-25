import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WriteResult } from "../src/dashboard/calendar/google.js";
import { emptyEventsDocument, validateEventsDocument, type EventFetchRequest, type EventFetchResult, type EventsDocument } from "../src/dashboard/calendar/events.js";
import { CalendarService } from "../src/dashboard/calendar/service.js";
import { JsonDocumentStore } from "../src/dashboard/store.js";
import { TwoWaySync, emptyConflictsDocument, emptyLinksDocument, validateConflictsDocument, validateLinksDocument, type ConflictsDocument, type GoogleWriter, type LinksDocument } from "../src/dashboard/calendar/twoway.js";
import { ValidationError } from "../src/dashboard/errors.js";

const ZONE = "Europe/Ljubljana";

class FakeGoogle implements GoogleWriter {
  events = new Map<string, Record<string, unknown>>();
  calls = { insert: 0, patch: 0, delete: 0 };
  private tick = 0;
  private stamp(): string { this.tick += 1; return new Date(Date.UTC(2027, 0, 1, 0, 0, 0, this.tick)).toISOString(); }
  async hasWriteScope(): Promise<boolean> { return true; }
  async fetchEvents(_c: string, request: EventFetchRequest): Promise<EventFetchResult> {
    if (request.pageToken) return { status: "ok", items: [], nextSyncToken: null, nextPageToken: null };
    return { status: "ok", items: [...this.events.values()], nextSyncToken: "t", nextPageToken: null };
  }
  async insertEvent(_c: string, body: Record<string, unknown>): Promise<WriteResult> {
    this.calls.insert += 1; const id = `g${this.calls.insert}`; const event = { ...body, id, updated: this.stamp() }; this.events.set(id, event); return { status: "ok", event };
  }
  async patchEvent(_c: string, id: string, body: Record<string, unknown>): Promise<WriteResult> {
    this.calls.patch += 1; const event = { ...this.events.get(id), ...body, id, updated: this.stamp() }; this.events.set(id, event); return { status: "ok", event };
  }
  async deleteEvent(_c: string, id: string): Promise<{ status: "ok" | "reconnect" | "error"; error?: string }> { this.calls.delete += 1; this.events.delete(id); return { status: "ok" }; }
}

async function harness(): Promise<{ service: CalendarService; links: JsonDocumentStore<LinksDocument>; google: FakeGoogle; two: TwoWaySync; dir: string; setNow(iso: string): void }> {
  const dir = await mkdtemp(join(tmpdir(), "viral-catmove-"));
  let now = new Date("2027-01-01T00:00:00.000Z");
  const service = new CalendarService(join(dir, "store.json"), { clock: () => now });
  const events = new JsonDocumentStore<EventsDocument>(join(dir, "events.json"), validateEventsDocument, emptyEventsDocument);
  await events.update((d) => { d.calendars = [{ id: "viral", name: "Viral test", colour: null, readOnly: false, syncToken: null }]; d.writeCalendarId = "viral"; });
  const links = new JsonDocumentStore<LinksDocument>(join(dir, "links.json"), validateLinksDocument, emptyLinksDocument);
  const conflicts = new JsonDocumentStore<ConflictsDocument>(join(dir, "conflicts.json"), validateConflictsDocument, emptyConflictsDocument);
  const google = new FakeGoogle();
  const two = new TwoWaySync(google, service, events, links, conflicts, { clock: () => now, zone: () => ZONE });
  return { service, links, google, two, dir, setNow: (iso) => { now = new Date(iso); } };
}

test("move: deleting a category with items requires a target, and nothing is deleted before the move", async () => {
  const h = await harness();
  try {
    const category = await h.service.createCategory({ name: "Work" });
    const item = await h.service.createItem({ kind: "task", title: "Report", date: "2027-02-10", time: "09:00", categoryId: category.id });

    await assert.rejects(h.service.deleteCategory(category.id), ValidationError, "a plain delete is refused");
    assert.equal((await h.service.listCategories()).length, 1, "the category is still there");
    assert.equal((await h.service.getItem(item.id)).categoryId, category.id, "the item is untouched");

    const other = await h.service.createCategory({ name: "Admin" });
    const { moved } = await h.service.moveItemsAndDeleteCategory(category.id, { categoryId: other.id });
    assert.equal(moved, 1);
    assert.equal((await h.service.listCategories()).some((candidate) => candidate.id === category.id), false, "now deleted");
    assert.equal((await h.service.getItem(item.id)).categoryId, other.id, "the item moved to the target");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("move: subcategory items move to a target (or Unfiled) and the subcategory is then deleted", async () => {
  const h = await harness();
  try {
    const category = await h.service.createCategory({ name: "Health", subcategories: [{ name: "Dentist" }, { name: "GP" }] });
    const [dentist, gp] = (await h.service.listCategories())[0]!.subcategories;
    const item = await h.service.createItem({ kind: "reminder", title: "Checkup", date: "2027-02-10", time: "09:00", categoryId: category.id, subcategoryId: dentist!.id });

    const { moved } = await h.service.moveItemsAndDeleteSubcategory(category.id, dentist!.id, { categoryId: category.id, subcategoryId: gp!.id });
    assert.equal(moved, 1);
    const moved_ = await h.service.getItem(item.id);
    assert.deepEqual([moved_.categoryId, moved_.subcategoryId], [category.id, gp!.id]);
    assert.equal((await h.service.listCategories())[0]!.subcategories.some((sub) => sub.id === dentist!.id), false, "subcategory deleted");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test("move: a moved item keeps its Google link and is pushed to the same event after the move", async () => {
  const h = await harness();
  try {
    const from = await h.service.createCategory({ name: "Work" });
    const to = await h.service.createCategory({ name: "Admin" });
    const item = await h.service.createItem({ kind: "reminder", title: "Standup", date: "2027-02-10", time: "09:00", categoryId: from.id });
    await h.two.reconcile();
    const eventId = (await h.links.read()).links[0]!.eventId;

    h.setNow("2027-01-02T00:00:00.000Z"); // the move happens later than the push
    await h.service.moveItemsAndDeleteCategory(from.id, { categoryId: to.id });
    await h.two.reconcile();

    const links = (await h.links.read()).links;
    assert.equal(links.length, 1, "still one link");
    assert.equal(links[0]!.itemId, item.id);
    assert.equal(links[0]!.eventId, eventId, "the moved item keeps the same Google event id");
    assert.equal(h.google.calls.insert, 1, "no new Google event — it was patched in place");
    assert.ok(h.google.calls.patch >= 1, "the moved item was pushed to the same event");
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});
