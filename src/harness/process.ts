import { spawn } from "node:child_process";
import type { ProcessResult, ProcessRunner, ProcessSpec } from "./types.js";

const maximumOutputBytes = 1_000_000;
const removedEnvironmentVariables = [
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"
];

function subscriptionEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of removedEnvironmentVariables) delete environment[name];
  return environment;
}

function sanitize(text: string): string {
  return text
    .replace(/\b(sk-(?:ant-)?[A-Za-z0-9_-]{12,})\b/g, "[REDACTED_TOKEN]")
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s]+/gi, "$1[REDACTED]");
}

function append(current: string, chunk: Buffer): string {
  if (Buffer.byteLength(current) >= maximumOutputBytes) return current;
  const remaining = maximumOutputBytes - Buffer.byteLength(current);
  const value = chunk.subarray(0, remaining).toString("utf8");
  return current + value + (chunk.byteLength > remaining ? "\n[OUTPUT TRUNCATED]" : "");
}

export class NodeProcessRunner implements ProcessRunner {
  async run(spec: ProcessSpec): Promise<ProcessResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    return await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let spawnError: string | null = null;
      let settled = false;
      const child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd,
        env: subscriptionEnvironment(),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, spec.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.on("error", (error: NodeJS.ErrnoException) => { spawnError = `${error.code ?? "PROCESS_ERROR"}: ${error.message}`; });
      child.on("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const finished = Date.now();
        resolve({
          startedAt,
          finishedAt: new Date(finished).toISOString(),
          durationMs: finished - started,
          exitCode,
          signal,
          timedOut,
          stdout: sanitize(stdout.trim()),
          stderr: sanitize(stderr.trim()),
          error: spawnError
        });
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(spec.stdin);
    });
  }
}

