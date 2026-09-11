import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { checkConfiguration, checkRuntimeStorage, formatHealthReport, runDoctor, type DoctorDependencies } from "../src/doctor.js";

function healthy(): DoctorDependencies {
  return {
    git: async () => ({}),
    local: async () => ({ provider: "ollama", displayName: "Ollama", executable: "ollama", installed: true, running: true, usable: true, version: "test", models: ["test"], preferredModel: "test", diagnostics: [] }),
    codex: async () => ({ id: "codex", displayName: "Codex CLI", executable: "codex", installed: true, usable: true, version: "test", diagnostics: [] }),
    storage: async () => "Readable/writable.", configuration: async () => undefined
  };
}

test("doctor reports all six checks and healthy text without inference or launches", async () => {
  const report = await runDoctor("unused", undefined, healthy());
  assert.equal(report.healthy, true);
  assert.equal(report.checks.length, 6);
  assert.equal(formatHealthReport(report).split("\n").length, 7);
  assert.match(formatHealthReport(report), /^Viral doctor: healthy/);
});

test("doctor isolates failures and does not leak raw diagnostics", async () => {
  const fail = async (): Promise<never> => { throw new Error("PRIVATE_SECRET"); };
  const report = await runDoctor("unused", undefined, { git: fail, local: fail, codex: fail, storage: fail, configuration: fail });
  assert.equal(report.checks.length, 6);
  assert.ok(report.checks.every((check) => !check.passed));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SECRET/);
});

test("doctor distinguishes missing model, service, CLI, and unknown authentication", async () => {
  for (const localPatch of [{ preferredModel: null }, { models: [] }, { running: false }, { installed: false }]) {
    const deps = healthy();
    const local = await deps.local();
    deps.local = async () => ({ ...local, ...localPatch });
    const report = await runDoctor("unused", undefined, deps);
    assert.equal(report.healthy, false);
    assert.equal(report.checks[3]?.passed, true);
  }
  for (const usable of [false, null]) {
    const deps = healthy();
    const codex = await deps.codex();
    deps.codex = async () => ({ ...codex, usable, diagnostics: ["PRIVATE_SECRET"] });
    const report = await runDoctor("unused", undefined, deps);
    assert.equal(report.checks[3]?.passed, false);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SECRET/);
  }
});

test("runtime check cleans up scratch files and preserves invalid snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "viral-doctor-"));
  assert.match(await checkRuntimeStorage(root), /no runtime snapshot/);
  assert.deepEqual(await readdir(root), []);
  await writeFile(join(root, "state.json"), "private invalid snapshot");
  await assert.rejects(checkRuntimeStorage(root), /Invalid runtime state/);
  assert.equal(await readFile(join(root, "state.json"), "utf8"), "private invalid snapshot");
  const file = join(root, "not-a-directory");
  await writeFile(file, "unchanged");
  await assert.rejects(checkRuntimeStorage(file));
});

test("configuration checks all sections without executing verification commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "viral-doctor-config-"));
  const source = JSON.parse(await readFile("viral-dev.config.json", "utf8")) as Record<string, unknown>;
  await writeFile(join(root, "viral-dev.config.json"), JSON.stringify(source));
  await checkConfiguration(root);
  for (const section of ["localBrain", "efficiencyGovernor", "verificationCommands"]) {
    await writeFile(join(root, "viral-dev.config.json"), JSON.stringify({ ...source, [section]: null }));
    await assert.rejects(checkConfiguration(root));
  }
});

test("doctor CLI emits complete JSON and exits nonzero with broken configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "viral-doctor-cli-"));
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, [cli, "doctor", "--json"], { env: { ...process.env, VIRAL_ROOT: root } }), (error: unknown) => {
    const failure = error as { code: number; stdout: string; stderr: string };
    assert.equal(failure.code, 1);
    const report = JSON.parse(failure.stdout) as { healthy: boolean; checks: unknown[] };
    assert.equal(report.healthy, false);
    assert.equal(report.checks.length, 6);
    assert.equal(failure.stderr, "");
    return true;
  });
});
