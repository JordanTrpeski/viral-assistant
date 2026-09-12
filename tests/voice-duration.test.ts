import assert from "node:assert/strict";
import test from "node:test";
import { parseDuration } from "../src/voice/duration.js";

test("parseDuration accepts human forms in seconds, milliseconds, and minutes", () => {
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("2s"), 2_000);
  assert.equal(parseDuration("500ms"), 500);
  assert.equal(parseDuration("1m"), 60_000);
  assert.equal(parseDuration("1.5s"), 1_500);
  assert.equal(parseDuration(" 30s "), 30_000);
});

test("parseDuration rejects invalid or non-positive input with a clear error", () => {
  assert.throws(() => parseDuration("abc"), /Invalid duration/);
  assert.throws(() => parseDuration("30"), /Invalid duration/);
  assert.throws(() => parseDuration("30sec"), /Invalid duration/);
  assert.throws(() => parseDuration("-5s"), /Invalid duration/);
  assert.throws(() => parseDuration("0s"), /Invalid duration/);
  assert.throws(() => parseDuration(""), /Invalid duration/);
});
