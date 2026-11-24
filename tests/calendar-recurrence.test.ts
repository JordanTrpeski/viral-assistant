import assert from "node:assert/strict";
import test from "node:test";
import type { Item, RecurrenceFreq } from "../src/dashboard/calendar/model.js";
import { clampedDate, daysInMonth, occurrences } from "../src/dashboard/calendar/recurrence.js";

// Fixtures only: minimal recurring items built directly.
function recurring(freq: RecurrenceFreq, anchor: string, extra: { until?: string | null; skips?: string[] } = {}): Item {
  return {
    id: "i1", kind: "task", title: "R", categoryId: null, subcategoryId: null, allDay: true, date: anchor, time: null,
    timeZone: "UTC", dueDate: null, plannedDate: null, priority: "normal", status: "open",
    recurrence: { freq, anchor, until: extra.until ?? null, skips: extra.skips ?? [] }, leadTimes: null, snoozedUntil: null,
    created: "", updated: ""
  };
}

test("recurrence: daysInMonth and clamp handle leap February and short months", () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(clampedDate(2026, 2, 31), "2026-02-28", "the 31st clamps to 28 Feb in a common year");
  assert.equal(clampedDate(2028, 2, 29), "2028-02-29", "29 Feb exists in a leap year");
  assert.equal(clampedDate(2026, 4, 31), "2026-04-30", "the 31st clamps to 30 in April");
});

test("recurrence: a monthly task on the 31st clamps to the last valid day each month", () => {
  const dates = occurrences(recurring("monthly", "2026-01-31"), "2026-01-01", "2026-04-30");
  assert.deepEqual(dates, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("recurrence: a yearly task on 29 February falls on 28 Feb in common years and returns on leap years", () => {
  const dates = occurrences(recurring("yearly", "2024-02-29"), "2025-01-01", "2028-12-31");
  assert.deepEqual(dates, ["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
});

test("recurrence: a weekly task is listed across a month boundary", () => {
  const dates = occurrences(recurring("weekly", "2026-01-26"), "2026-01-26", "2026-02-16");
  assert.deepEqual(dates, ["2026-01-26", "2026-02-02", "2026-02-09", "2026-02-16"]);
});

test("recurrence: a mid-range weekly query starts at the first occurrence on or after the range start", () => {
  const dates = occurrences(recurring("weekly", "2026-01-05"), "2026-01-20", "2026-02-05");
  assert.deepEqual(dates, ["2026-01-26", "2026-02-02"]);
});

test("recurrence: until ends the series and skips remove single occurrences", () => {
  const ended = occurrences(recurring("weekly", "2026-01-05", { until: "2026-01-19" }), "2026-01-01", "2026-03-01");
  assert.deepEqual(ended, ["2026-01-05", "2026-01-12", "2026-01-19"]);
  const skipped = occurrences(recurring("weekly", "2026-01-05", { skips: ["2026-01-12"] }), "2026-01-01", "2026-01-26");
  assert.deepEqual(skipped, ["2026-01-05", "2026-01-19", "2026-01-26"]);
});

test("recurrence: a non-recurring item yields its own date only when it is in range", () => {
  const item = recurring("weekly", "2026-01-05");
  item.recurrence = null;
  item.date = "2026-01-15";
  assert.deepEqual(occurrences(item, "2026-01-01", "2026-01-31"), ["2026-01-15"]);
  assert.deepEqual(occurrences(item, "2026-02-01", "2026-02-28"), []);
});
