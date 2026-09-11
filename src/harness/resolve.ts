import { existsSync } from "node:fs";
import { extname, isAbsolute, join, win32 } from "node:path";
import type { ProcessCommand } from "./types.js";

export interface CommandResolutionOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  if (environment[name] !== undefined) return environment[name];
  const match = Object.keys(environment).find((key) => key.toUpperCase() === name.toUpperCase());
  return match === undefined ? undefined : environment[match];
}

function expandEnvironment(value: string, environment: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (original, name: string) => environmentValue(environment, name) ?? original);
}

function windowsCandidates(command: string, environment: NodeJS.ProcessEnv): string[] {
  const explicitPath = isAbsolute(command) || /[\\/]/.test(command);
  const directories = explicitPath
    ? [""]
    : (environmentValue(environment, "PATH") ?? "").split(";").map((entry) => expandEnvironment(entry.trim().replace(/^"|"$/g, ""), environment)).filter(Boolean);
  const configuredExtensions = (environmentValue(environment, "PATHEXT") ?? "").split(";").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const extensions = extname(command)
    ? [""]
    : [...new Set([".exe", ".cmd", ".bat", ".com", ".ps1", ...configuredExtensions, ""])];
  return directories.flatMap((directory) => extensions.map((extension) => directory ? win32.join(directory, `${command}${extension}`) : `${command}${extension}`));
}

function wrapWindowsShim(resolved: string, environment: NodeJS.ProcessEnv): ProcessCommand {
  const extension = extname(resolved).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    return {
      executable: environmentValue(environment, "COMSPEC") ?? "cmd.exe",
      prefixArgs: ["/d", "/s", "/c", "call", resolved],
      resolvedExecutable: resolved
    };
  }
  if (extension === ".ps1") {
    const systemRoot = environmentValue(environment, "SYSTEMROOT");
    const bundledPowerShell = systemRoot ? join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : null;
    return {
      executable: bundledPowerShell && existsSync(bundledPowerShell) ? bundledPowerShell : "powershell.exe",
      prefixArgs: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolved],
      resolvedExecutable: resolved
    };
  }
  return { executable: resolved, resolvedExecutable: resolved };
}

export function resolveHarnessCommand(command: string, options: CommandResolutionOptions = {}): ProcessCommand {
  if (!command.trim()) throw new Error("Harness command must be non-empty");
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { executable: command };
  const environment = options.environment ?? process.env;
  const exists = options.exists ?? existsSync;
  const resolved = windowsCandidates(command, environment).find((candidate) => exists(candidate));
  return resolved ? wrapWindowsShim(resolved, environment) : { executable: command };
}
