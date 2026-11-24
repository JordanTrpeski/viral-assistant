import assert from "node:assert/strict";
import test from "node:test";
import { zonedToInstant } from "../src/dashboard/calendar/timezone.js";

const LJ = "Europe/Ljubljana";

// Europe/Ljubljana is CET (UTC+1) in winter and CEST (UTC+2) in summer. Fixtures only.

test("timezone: a plain winter and summer wall clock converts with the right offset", () => {
  const winter = zonedToInstant("2027-01-15", "09:00", LJ);
  assert.deepEqual([winter.offset, winter.instant], ["+01:00", "2027-01-15T08:00:00.000Z"]);
  const summer = zonedToInstant("2027-07-15", "09:00", LJ);
  assert.deepEqual([summer.offset, summer.instant], ["+02:00", "2027-07-15T07:00:00.000Z"]);
});

test("timezone: clocks forward on 28 March 2027 — a time before and after the change", () => {
  const before = zonedToInstant("2027-03-28", "01:30", LJ); // still CET
  assert.deepEqual([before.offset, before.instant], ["+01:00", "2027-03-28T00:30:00.000Z"]);
  const after = zonedToInstant("2027-03-28", "03:30", LJ); // now CEST
  assert.deepEqual([after.offset, after.instant], ["+02:00", "2027-03-28T01:30:00.000Z"]);
  assert.equal(after.rfc3339, "2027-03-28T03:30:00+02:00");
});

test("timezone: clocks back on 31 October 2027 — a time before and after the change", () => {
  const before = zonedToInstant("2027-10-31", "01:30", LJ); // still CEST
  assert.deepEqual([before.offset, before.instant], ["+02:00", "2027-10-30T23:30:00.000Z"]);
  const after = zonedToInstant("2027-10-31", "03:30", LJ); // now CET
  assert.deepEqual([after.offset, after.instant], ["+01:00", "2027-10-31T02:30:00.000Z"]);
});
