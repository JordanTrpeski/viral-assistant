import type { HarnessId, HarnessProbe, ProcessCommand, ProcessResult, ProcessRunner } from "./types.js";

export function commandParts(command: ProcessCommand, args: string[]): { executable: string; args: string[] } {
  return { executable: command.executable, args: [...(command.prefixArgs ?? []), ...args] };
}

export async function probeHarness(
  id: HarnessId,
  displayName: string,
  command: ProcessCommand,
  runner: ProcessRunner,
  authArgs: string[],
  root: string
): Promise<HarnessProbe> {
  const versionCommand = commandParts(command, ["--version"]);
  const version = await runner.run({ ...versionCommand, cwd: root, stdin: "", timeoutMs: 5_000 });
  if (version.error || version.exitCode !== 0 || version.timedOut) {
    return {
      id, displayName, executable: command.executable, installed: false, usable: false, version: null,
      diagnostics: diagnostics(version, "Version probe failed")
    };
  }
  const authCommand = commandParts(command, authArgs);
  const auth = await runner.run({ ...authCommand, cwd: root, stdin: "", timeoutMs: 10_000 });
  return {
    id,
    displayName,
    executable: command.executable,
    installed: true,
    usable: auth.exitCode === 0 && !auth.error && !auth.timedOut,
    version: firstLine(version.stdout || version.stderr),
    diagnostics: diagnostics(auth, auth.exitCode === 0 ? "Authentication probe passed" : "Authentication probe failed")
  };
}

export function diagnostics(result: ProcessResult, summary: string): string[] {
  const details = [summary];
  if (result.timedOut) details.push("Process timed out.");
  if (result.error) details.push(result.error);
  if (result.exitCode !== null) details.push(`Exit code: ${result.exitCode}.`);
  const message = firstLine(result.stderr || result.stdout);
  if (message) details.push(message);
  return details;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.slice(0, 500) ?? "";
}

