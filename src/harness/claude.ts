import { diagnostics, commandParts, probeHarness } from "./shared.js";
import type { DevelopmentHarness, HarnessLaunchRequest, HarnessRunResult, ProcessCommand, ProcessRunner } from "./types.js";

export class ClaudeHarness implements DevelopmentHarness {
  readonly id = "claude" as const;
  readonly displayName = "Claude Code";

  constructor(private readonly runner: ProcessRunner, private readonly command: ProcessCommand = { executable: "claude" }, private readonly probeRoot = process.cwd()) {}

  probe() { return probeHarness(this.id, this.displayName, this.command, this.runner, ["auth", "status", "--json"], this.probeRoot); }

  async launch(request: HarnessLaunchRequest): Promise<HarnessRunResult> {
    const command = commandParts(this.command, ["-p", "--output-format", "stream-json", "--verbose", "--max-turns", "20", ...(request.model ? ["--model", request.model] : [])]);
    const result = await this.runner.run({ ...command, cwd: request.root, stdin: request.packet, timeoutMs: request.timeoutMs });
    const succeeded = result.exitCode === 0 && !result.error && !result.timedOut;
    return { ...result, harness: this.id, displayName: this.displayName, command: [command.executable, ...command.args], succeeded, diagnostics: diagnostics(result, succeeded ? "Claude run completed." : "Claude run failed.") };
  }
}

