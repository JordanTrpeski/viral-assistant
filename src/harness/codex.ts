import { diagnostics, commandParts, probeHarness } from "./shared.js";
import type { DevelopmentHarness, HarnessLaunchRequest, HarnessRunResult, ProcessCommand, ProcessRunner } from "./types.js";

export class CodexHarness implements DevelopmentHarness {
  readonly id = "codex" as const;
  readonly displayName = "Codex CLI";

  constructor(private readonly runner: ProcessRunner, private readonly command: ProcessCommand = { executable: "codex" }, private readonly probeRoot = process.cwd()) {}

  probe() { return probeHarness(this.id, this.displayName, this.command, this.runner, ["login", "status"], this.probeRoot); }

  async launch(request: HarnessLaunchRequest): Promise<HarnessRunResult> {
    const command = commandParts(this.command, [
      "exec", "--json", "--color", "never", "-C", request.root,
      "--sandbox", "workspace-write", "--ask-for-approval", "never", "-"
    ]);
    const result = await this.runner.run({ ...command, cwd: request.root, stdin: request.packet, timeoutMs: request.timeoutMs });
    const succeeded = result.exitCode === 0 && !result.error && !result.timedOut;
    return { ...result, harness: this.id, displayName: this.displayName, command: [command.executable, ...command.args], succeeded, diagnostics: diagnostics(result, succeeded ? "Codex run completed." : "Codex run failed.") };
  }
}
