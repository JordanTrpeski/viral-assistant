import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeHarness } from "../src/harness/claude.js";
import { CodexHarness } from "../src/harness/codex.js";
import { NodeProcessRunner } from "../src/harness/process.js";
import type { ProcessResult, ProcessRunner, ProcessSpec } from "../src/harness/types.js";
import { fixture } from "./helpers.js";

function result(changes: Partial<ProcessResult> = {}): ProcessResult {
  return {
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.001Z",
    durationMs: 1, exitCode: 0, signal: null, timedOut: false, stdout: "ok", stderr: "", error: null,
    ...changes
  };
}

class RecordingRunner implements ProcessRunner {
  readonly calls: ProcessSpec[] = [];
  constructor(private readonly results: ProcessResult[]) {}
  async run(spec: ProcessSpec): Promise<ProcessResult> {
    this.calls.push(spec);
    return this.results.shift() ?? result();
  }
}

test("Codex adapter probes auth and launches a stdin packet in workspace sandbox", async () => {
  const root = await fixture();
  const runner = new RecordingRunner([result({ stdout: "codex-cli 1.0" }), result({ stdout: "Logged in" }), result()]);
  const harness = new CodexHarness(runner, { executable: "codex-test" }, root);
  const probe = await harness.probe();
  assert.equal(probe.installed, true);
  assert.equal(probe.usable, true);
  const launch = await harness.launch({ root, packet: "packet-body", timeoutMs: 12_000 });
  const call = runner.calls[2];
  assert.equal(call?.stdin, "packet-body");
  assert.equal(call?.args[0], "exec");
  assert.equal(call?.args.at(-1), "-");
  assert.ok(call?.args.includes("workspace-write"));
  assert.ok(!call?.args.some((value) => value.includes("dangerously")));
  assert.equal(launch.succeeded, true);
});

test("Claude adapter uses print mode with stdin and structured output", async () => {
  const root = await fixture();
  const runner = new RecordingRunner([result()]);
  const harness = new ClaudeHarness(runner, { executable: "claude-test" }, root);
  await harness.launch({ root, packet: "handoff-packet", timeoutMs: 12_000 });
  const call = runner.calls[0];
  assert.equal(call?.stdin, "handoff-packet");
  assert.ok(call?.args.includes("-p"));
  assert.ok(call?.args.includes("stream-json"));
  assert.ok(!call?.args.some((value) => value.includes("dangerously")));
});

test("process runner captures missing executables and timeouts", async () => {
  const root = await fixture();
  const runner = new NodeProcessRunner();
  const missing = await runner.run({ executable: "definitely-missing-jarvis-command", args: [], cwd: root, stdin: "", timeoutMs: 1_000 });
  assert.match(missing.error ?? "", /ENOENT/);
  assert.notEqual(missing.exitCode, 0);
  const timeout = await runner.run({ executable: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"], cwd: root, stdin: "", timeoutMs: 1_000 });
  assert.equal(timeout.timedOut, true);
  assert.notEqual(timeout.exitCode, 0);
});
