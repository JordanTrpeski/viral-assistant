import assert from "node:assert/strict";
import test from "node:test";
import type { Item } from "../src/dashboard/calendar/model.js";
import { itemsToCsv } from "../src/dashboard/calendar/views.js";
import { kindLabel, kindLabelPlural } from "../src/dashboard/shared/kind-labels.js";

function item(kind: Item["kind"], title: string): Item {
  return {
    id: `${kind}-1`, kind, title, categoryId: null, subcategoryId: null, allDay: false, date: "2027-02-10",
    time: "09:00", timeZone: "Europe/Ljubljana", dueDate: "2027-02-10", plannedDate: null, priority: "normal",
    status: "open", recurrence: null, leadTimes: null, snoozedUntil: null, created: "x", updated: "x"
  };
}

test("labels: a task shows as Deadline and a reminder as Event", () => {
  assert.equal(kindLabel("task"), "Deadline");
  assert.equal(kindLabel("reminder"), "Event");
  assert.equal(kindLabelPlural("task"), "Deadlines");
  assert.equal(kindLabelPlural("reminder"), "Events");
});

test("labels: the CSV export header uses the display names while the stored kind stays unchanged", () => {
  const deadline = item("task", "Essay");
  const event = item("reminder", "Birthday");
  assert.equal(deadline.kind, "task", "the stored kind is unchanged");
  assert.equal(event.kind, "reminder", "the stored kind is unchanged");

  const lines = itemsToCsv([deadline, event]).trim().split("\n");
  assert.equal(lines[0]!.split(",")[0], "type", "the kind column header is shown as 'type'");
  assert.equal(lines[1]!.split(",")[0], "Deadline");
  assert.equal(lines[2]!.split(",")[0], "Event");
});
