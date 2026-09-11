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
      id, displayName, executable: command.resolvedExecutable ?? command.executable, installed: false, usable: false, version: null,
      diagnostics: diagnostics(version, "Version probe failed")
    };
  }
  const authCommand = commandParts(command, authArgs);
  const auth = await runner.run({ ...authCommand, cwd: root, stdin: "", timeoutMs: 10_000 });
  const output = `${auth.stdout}\n${auth.stderr}`;
  let usable: boolean | null = null;
  if (!auth.error && !auth.timedOut) {
    if (id === "claude") {
      try {
        const status = JSON.parse(auth.stdout) as { loggedIn?: boolean };
        if (typeof status.loggedIn === "boolean") usable = status.loggedIn && auth.exitCode === 0;
      } catch { /* Unsupported or unreadable status leaves authentication unknown. */ }
    } else if (auth.exitCode === 0 && /logged in using ChatGPT/i.test(output)) usable = true;
    else if (/not logged in|logged in using an? API key/i.test(output)) usable = false;
  }
  return {
    id,
    displayName,
    executable: command.resolvedExecutable ?? command.executable,
    installed: true,
    usable,
    version: firstLine(version.stdout || version.stderr),
    diagnostics: diagnostics(auth, usable === null ? "Authentication could not be determined safely" : usable ? "Authentication probe passed" : "Subscription authentication unavailable")
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
