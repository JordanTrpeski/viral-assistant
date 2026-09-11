import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { readJson, writeJson } from "./files.js";
import type { VerificationReport, VerificationResult } from "./types.js";

const run = promisify(exec);

interface VerificationConfig { verificationCommands: Array<{ name: string; command: string }>; }

export function validateVerificationConfig(value: unknown): VerificationConfig {
  const commands = (value as VerificationConfig | null)?.verificationCommands;
  if (!Array.isArray(commands) || commands.length === 0 || commands.some((item) => typeof item?.name !== "string" || !item.name.trim() || typeof item.command !== "string" || !item.command.trim())) {
    throw new Error("viral-dev.config.json must define non-empty verificationCommands");
  }
  return { verificationCommands: commands };
}

export async function runVerification(root: string): Promise<VerificationReport> {
  const config = validateVerificationConfig(await readJson(join(root, "viral-dev.config.json")));
  const results: VerificationResult[] = [];
  for (const entry of config.verificationCommands) {
    const started = Date.now();
    try {
      const { stdout, stderr } = await run(entry.command, { cwd: root, encoding: "utf8", windowsHide: true });
      results.push({ ...entry, passed: true, exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim(), durationMs: Date.now() - started });
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      results.push({ ...entry, passed: false, exitCode: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout?.trim() ?? "", stderr: failure.stderr?.trim() ?? failure.message, durationMs: Date.now() - started });
    }
  }
  const report: VerificationReport = { schemaVersion: 1, executedAt: new Date().toISOString(), passed: results.every((item) => item.passed), results };
  await writeJson(join(root, "verification", "latest.json"), report);
  return report;
}
