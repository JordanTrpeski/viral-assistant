import assert from "node:assert/strict";
import test from "node:test";
import type { Item } from "../src/dashboard/calendar/model.js";
import type { EventsDocument } from "../src/dashboard/calendar/events.js";
import { eventsForRange, monthView, todayStrip, weekView } from "../src/dashboard/calendar/views.js";

function item(over: Partial<Item> & Pick<Item, "kind" | "title" | "date">): Item {
  return {
    id: over.id ?? `${over.kind}-${over.title}`, kind: over.kind, title: over.title,
    categoryId: null, subcategoryId: null, allDay: over.allDay ?? true, date: over.date, time: over.time ?? null,
    timeZone: "Europe/Ljubljana", dueDate: over.dueDate ?? null, plannedDate: over.plannedDate ?? null,
    priority: over.priority ?? "normal", status: over.status ?? "open", recurrence: over.recurrence ?? null,
    leadTimes: null, snoozedUntil: null, created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z"
  };
}

function eventsDoc(prefs: EventsDocument["prefs"] = {}): EventsDocument {
  return {
    schemaVersion: 1,
    calendars: [
      { id: "mine", name: "Mine", colour: null, readOnly: false, syncToken: null },
      { id: "holidays", name: "Slovenian holidays", colour: "#abc", readOnly: true, syncToken: null }
    ],
    events: [
      { calendarId: "mine", eventId: "e1", title: "Standup", allDay: false, start: "2026-11-26T09:00:00+01:00", end: null, date: "2026-11-26", time: "09:00", endTime: null, endDate: null, timeZone: "Europe/Ljubljana", status: "confirmed", colour: null },
      { calendarId: "holidays", eventId: "h1", title: "Holiday", allDay: true, start: null, end: null, date: "2026-11-27", time: null, endTime: null, endDate: "2026-11-27", timeZone: "Europe/Ljubljana", status: "confirmed", colour: "#abc" }
    ],
    prefs,
    lastSync: null
  };
}

const TODAY = "2026-11-25";

test("views: the week lists the right items and events, with subscribed/holiday events dimmed and labelled", () => {
  const items = [item({ kind: "task", title: "Essay", date: "2026-11-26", allDay: false, time: "14:00" })];
  const week = weekView(TODAY, items, eventsDoc(), TODAY);

  const wed = week.days.find((day) => day.date === "2026-11-26")!;
  assert.ok(wed.items.some((displayed) => displayed.title === "Essay"));
  assert.ok(wed.events.some((displayed) => displayed.title === "Standup" && !displayed.dimmed));

  const fri = week.days.find((day) => day.date === "2026-11-27")!;
  const holiday = fri.events.find((displayed) => displayed.title === "Holiday")!;
  assert.equal(holiday.dimmed, true, "a read-only subscribed/holiday calendar is dimmed");
  assert.equal(holiday.calendarName, "Slovenian holidays", "and labelled with its calendar name");
});

test("views: the month lists items and events on their days", () => {
  const items = [item({ kind: "reminder", title: "Birthday", date: "2026-11-27" })];
  const month = monthView("2026-11", items, eventsDoc(), TODAY);
  const allCells = month.weeks.flat();
  const cell = allCells.find((day) => day.date === "2026-11-27")!;
  assert.ok(cell.items.some((displayed) => displayed.title === "Birthday"));
  assert.ok(cell.events.some((displayed) => displayed.title === "Holiday" && displayed.dimmed));
});

test("views: the highlight toggle flags display but never changes the stored events", () => {
  const document = eventsDoc({ holidays: { highlight: true, hidden: false } });
  const before = JSON.stringify(document.events);
  const display = eventsForRange(document, "2026-11-23", "2026-11-29");
  const holiday = display.find((event) => event.title === "Holiday")!;
  assert.equal(holiday.highlight, true, "the display event is highlighted");
  assert.equal(JSON.stringify(document.events), before, "the stored events are untouched");
});

test("views: a hidden calendar is dropped from the range", () => {
  const document = eventsDoc({ holidays: { highlight: false, hidden: true } });
  const display = eventsForRange(document, "2026-11-23", "2026-11-29");
  assert.ok(!display.some((event) => event.title === "Holiday"), "a hidden calendar's events do not appear");
  assert.ok(display.some((event) => event.title === "Standup"), "visible calendars still appear");
});

test("views: the Today strip carries over overdue open tasks", () => {
  const items = [
    item({ kind: "task", title: "Overdue essay", date: "2026-11-20", allDay: false }),
    item({ kind: "task", title: "Done already", date: "2026-11-19", status: "done" }),
    item({ kind: "task", title: "Due today", date: TODAY })
  ];
  const strip = todayStrip(TODAY, items, eventsDoc());
  assert.ok(strip.overdue.some((displayed) => displayed.title === "Overdue essay"), "an open task from before today is carried over");
  assert.ok(!strip.overdue.some((displayed) => displayed.title === "Done already"), "a completed task is not overdue");
  assert.ok(strip.items.some((displayed) => displayed.title === "Due today"), "today's items are listed");
});
