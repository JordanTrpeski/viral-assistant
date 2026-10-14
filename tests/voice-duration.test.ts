import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, parseDuration } from "../src/voice/duration.js";

test("parseDuration understands human duration forms", () => {
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("2s"), 2_000);
  assert.equal(parseDuration("500ms"), 500);
  assert.equal(parseDuration("1m"), 60_000);
  assert.equal(parseDuration("1m30s"), 90_000);
  assert.equal(parseDuration(" 2s "), 2_000);
});

test("parseDuration rejects invalid, empty, or non-positive input", () => {
  assert.throws(() => parseDuration(""), /Invalid duration/);
  assert.throws(() => parseDuration("abc"), /Invalid duration/);
  assert.throws(() => parseDuration("30"), /Invalid duration/);
  assert.throws(() => parseDuration("30x"), /Invalid duration/);
  assert.throws(() => parseDuration("-5s"), /Invalid duration/);
  assert.throws(() => parseDuration("0s"), /greater than zero/);
});

test("formatDuration prints whole seconds compactly and falls back to milliseconds", () => {
  assert.equal(formatDuration(30_000), "30s");
  assert.equal(formatDuration(500), "500ms");
});
