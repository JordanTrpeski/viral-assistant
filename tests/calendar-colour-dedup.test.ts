import assert from "node:assert/strict";
import test from "node:test";
import type { StoredEvent } from "../src/dashboard/calendar/events.js";
import { emptyEventsDocument, parseGoogleEvent, upcomingEvents, type EventsDocument } from "../src/dashboard/calendar/events.js";
import { eventsForRange } from "../src/dashboard/calendar/views.js";

const ZONE = "Europe/Ljubljana";

function parsed(raw: Record<string, unknown>): StoredEvent {
  const result = parseGoogleEvent(raw, { calendarId: "viral", colour: null, zone: ZONE });
  assert.equal(result.kind, "event");
  return (result as { kind: "event"; event: StoredEvent }).event;
}

function doc(events: StoredEvent[]): EventsDocument {
  return { ...emptyEventsDocument(), calendars: [{ id: "viral", name: "Viral test", colour: null, readOnly: false, syncToken: null }], events };
}

test("dedup: an event carrying our viralItemId is marked appOwned and left out of the views (shown as its app item)", () => {
  const owned = parsed({ id: "g1", status: "confirmed", summary: "Standup", start: { dateTime: "2027-02-10T09:00:00+01:00" }, end: { dateTime: "2027-02-10T09:30:00+01:00" }, extendedProperties: { private: { viralItemId: "it1", viralCategoryId: "cat1" } } });
  assert.equal(owned.appOwned, true, "an app-pushed event is recognised");

  const other = parsed({ id: "g2", status: "confirmed", summary: "Client meeting", start: { dateTime: "2027-02-11T10:00:00+01:00" }, end: { dateTime: "2027-02-11T11:00:00+01:00" } });
  assert.equal(other.appOwned, false);

  const shown = eventsForRange(doc([owned, other]), "2027-02-01", "2027-02-28");
  assert.deepEqual(shown.map((event) => event.title), ["Client meeting"], "the app-owned event is not duplicated as a Google event");
});

test("dedup: a colour change does not change appOwned (the private properties survive)", () => {
  // Same event, now with a different colorId — still carries viralItemId, so still app-owned and hidden.
  const recoloured = parsed({ id: "g1", status: "confirmed", summary: "Standup", colorId: "11", start: { dateTime: "2027-02-10T09:00:00+01:00" }, end: { dateTime: "2027-02-10T09:30:00+01:00" }, extendedProperties: { private: { viralItemId: "it1" } } });
  assert.equal(recoloured.appOwned, true);
  assert.equal(eventsForRange(doc([recoloured]), "2027-02-01", "2027-02-28").length, 0);
  assert.equal(upcomingEvents(doc([recoloured]), "2027-02-10", 7).length, 0, "the 7-day list drops it too");
});

test("dedup: an event whose private props were stripped is still excluded via the link store", () => {
  const stripped = parsed({ id: "g1", status: "confirmed", summary: "Standup", start: { dateTime: "2027-02-10T09:00:00+01:00" }, end: { dateTime: "2027-02-10T09:30:00+01:00" } });
  assert.equal(stripped.appOwned, false, "with no viralItemId it cannot self-identify");
  assert.equal(eventsForRange(doc([stripped]), "2027-02-01", "2027-02-28").length, 1, "without the link it would show (the duplicate)");
  assert.equal(eventsForRange(doc([stripped]), "2027-02-01", "2027-02-28", new Set(["g1"])).length, 0, "the link store excludes it");
});
