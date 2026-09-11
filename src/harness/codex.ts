import { diagnostics, commandParts, probeHarness } from "./shared.js";
import type { DevelopmentHarness, HarnessLaunchRequest, HarnessRunResult, ProcessCommand, ProcessRunner } from "./types.js";

export class CodexHarness implements DevelopmentHarness {
  readonly id = "codex" as const;
  readonly displayName = "Codex CLI";

  constructor(private readonly runner: ProcessRunner, private readonly command: ProcessCommand = { executable: "codex" }, private readonly probeRoot = process.cwd()) {}

  probe() { return probeHarness(this.id, this.displayName, this.command, this.runner, ["login", "status"], this.probeRoot); }

  async launch(request: HarnessLaunchRequest): Promise<HarnessRunResult> {
    const selectionArgs = [
      ...(request.model ? ["--model", request.model] : []),
      ...(request.reasoningEffort ? ["-c", `model_reasoning_effort="${request.reasoningEffort}"`] : [])
    ];
    const command = commandParts(this.command, [
      "--ask-for-approval", "never", "exec", "--json", "--color", "never", "-C", request.root,
      "--sandbox", "workspace-write", ...selectionArgs, "-"
    ]);
    const result = await this.runner.run({ ...command, cwd: request.root, stdin: request.packet, timeoutMs: request.timeoutMs });
    const succeeded = result.exitCode === 0 && !result.error && !result.timedOut;
    return { ...result, harness: this.id, displayName: this.displayName, command: [command.executable, ...command.args], succeeded, diagnostics: diagnostics(result, succeeded ? "Codex run completed." : "Codex run failed.") };
  }
}
