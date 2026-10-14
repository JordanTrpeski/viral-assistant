import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

test("voice listen rejects an invalid --timeout before touching any local audio engine", async () => {
  await assert.rejects(run(process.execPath, [cli, "voice", "listen", "--timeout", "bogus"]), (error: unknown) => {
    const failure = error as { code: number; stdout: string; stderr: string };
    assert.equal(failure.code, 1);
    assert.match(failure.stderr, /Invalid duration/);
    return true;
  });
});

test("voice --help documents the listen subcommand without requiring a subcommand", async () => {
  const result = await run(process.execPath, [cli, "voice", "--help"]);
  assert.match(result.stdout, /voice listen/);
  assert.equal(result.stderr, "");
});

test("top-level help lists the voice command", async () => {
  const result = await run(process.execPath, [cli, "--help"]);
  assert.match(result.stdout, /voice/);
});
