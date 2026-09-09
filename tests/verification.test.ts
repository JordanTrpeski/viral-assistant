import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runVerification } from "../src/verification.js";
import { fixture } from "./helpers.js";

test("captures structured pass and fail verification results", async () => {
  const root = await fixture();
  await writeFile(join(root, "jarvis-dev.config.json"), JSON.stringify({ verificationCommands: [
    { name: "pass", command: "node -e \"console.log('ok')\"" },
    { name: "fail", command: "node -e \"console.error('bad'); process.exit(3)\"" }
  ] }), "utf8");
  const report = await runVerification(root);
  assert.equal(report.passed, false);
  assert.equal(report.results[0]?.stdout, "ok");
  assert.equal(report.results[1]?.exitCode, 3);
  assert.equal(report.results[1]?.stderr, "bad");
  assert.deepEqual(JSON.parse(await readFile(join(root, "verification", "latest.json"), "utf8")), report);
});

