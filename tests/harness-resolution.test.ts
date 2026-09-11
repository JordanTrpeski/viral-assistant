import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexHarness } from "../src/harness/codex.js";
import { NodeProcessRunner } from "../src/harness/process.js";
import { resolveHarnessCommand } from "../src/harness/resolve.js";
import { fixture } from "./helpers.js";

test("non-Windows harness commands retain normal PATH execution", () => {
  assert.deepEqual(resolveHarnessCommand("codex", { platform: "linux" }), { executable: "codex" });
  assert.deepEqual(resolveHarnessCommand("codex", { platform: "darwin" }), { executable: "codex" });
});

test("Windows resolution prefers executable npm shims and records the resolved command", () => {
  const existing = new Set(["C:\\tools\\codex.cmd", "C:\\tools\\codex.ps1"]);
  const resolved = resolveHarnessCommand("codex", {
    platform: "win32",
    environment: { PATH: "C:\\tools", COMSPEC: "C:\\Windows\\System32\\cmd.exe" },
    exists: (candidate) => existing.has(candidate)
  });
  assert.equal(resolved.executable, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(resolved.prefixArgs, ["/d", "/s", "/c", "call", "C:\\tools\\codex.cmd"]);
  assert.equal(resolved.resolvedExecutable, "C:\\tools\\codex.cmd");
});

test("Windows resolution supports PowerShell-only npm shims", () => {
  const resolved = resolveHarnessCommand("codex", {
    platform: "win32",
    environment: { PATH: "C:\\tools" },
    exists: (candidate) => candidate === "C:\\tools\\codex.ps1"
  });
  assert.match(resolved.executable, /powershell\.exe$/i);
  assert.deepEqual(resolved.prefixArgs?.slice(-2), ["-File", "C:\\tools\\codex.ps1"]);
  assert.equal(resolved.resolvedExecutable, "C:\\tools\\codex.ps1");
});

test("Windows cmd shim probe retrieves version and preserves authentication status", { skip: process.platform !== "win32" }, async () => {
  const root = await fixture();
  const shimDirectory = await mkdtemp(join(tmpdir(), "viral codex cmd shim "));
  const shim = join(shimDirectory, "codex.cmd");
  await writeFile(shim, [
    "@echo off",
    "if \"%~1\"==\"--version\" (echo codex-cli 9.9.9& exit /b 0)",
    "if \"%~1\"==\"login\" if \"%~2\"==\"status\" (echo Logged in using ChatGPT& exit /b 0)",
    "if \"%~1\"==\"--ask-for-approval\" (echo executed& exit /b 0)",
    "exit /b 2"
  ].join("\r\n"), "utf8");
  const environment = { ...process.env, PATH: shimDirectory };
  const command = resolveHarnessCommand("codex", { platform: "win32", environment });
  const probe = await new CodexHarness(new NodeProcessRunner(), command, root).probe();
  assert.equal(probe.installed, true);
  assert.equal(probe.version, "codex-cli 9.9.9");
  assert.equal(probe.usable, true);
  assert.equal(probe.executable, shim);
  const launch = await new CodexHarness(new NodeProcessRunner(), command, root).launch({ root, packet: "task packet", timeoutMs: 5_000 });
  assert.equal(launch.succeeded, true);
  assert.match(launch.stdout, /executed/);
});

test("Windows PowerShell shim probe retrieves version without assuming usability", { skip: process.platform !== "win32" }, async () => {
  const root = await fixture();
  const shimDirectory = await mkdtemp(join(tmpdir(), "viral codex ps shim "));
  const shim = join(shimDirectory, "codex.ps1");
  await writeFile(shim, [
    "param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Rest)",
    "if ($Rest[0] -eq '--version') { Write-Output 'codex-cli 8.8.8'; exit 0 }",
    "if ($Rest[0] -eq 'login') { Write-Error 'status unavailable'; exit 1 }",
    "exit 2"
  ].join("\r\n"), "utf8");
  await chmod(shim, 0o755);
  const environment = { ...process.env, PATH: shimDirectory };
  const command = resolveHarnessCommand("codex", { platform: "win32", environment, exists: (candidate) => candidate.toLowerCase() === shim.toLowerCase() });
  const probe = await new CodexHarness(new NodeProcessRunner(), command, root).probe();
  assert.equal(probe.installed, true);
  assert.equal(probe.version, "codex-cli 8.8.8");
  assert.equal(probe.usable, null);
  assert.equal(probe.executable, shim);
});
