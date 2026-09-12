import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

test("Viral CLI help exposes the canonical command and succeeds", async () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const result = await run(process.execPath, [cli, "--help"]);
  assert.match(result.stdout, /^Usage: viral-dev /);
  assert.match(result.stdout, /objective/);
  assert.match(result.stdout, /finalize/);
  assert.match(result.stdout, /voice/);
  assert.equal(result.stderr, "");
});

test("Viral CLI voice command requires the listen subcommand and validates --timeout", async () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  await assert.rejects(run(process.execPath, [cli, "voice"]), /listen/);
  await assert.rejects(run(process.execPath, [cli, "voice", "bogus"]), /listen/);
  await assert.rejects(run(process.execPath, [cli, "voice", "listen", "--timeout", "notaduration"]), /Invalid duration/);
  await assert.rejects(run(process.execPath, [cli, "voice", "listen", "--timeout"]), /requires a duration value/);
});
