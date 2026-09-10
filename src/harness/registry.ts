import { ClaudeHarness } from "./claude.js";
import { CodexHarness } from "./codex.js";
import { NodeProcessRunner } from "./process.js";
import type { DevelopmentHarness, HarnessId } from "./types.js";

export function createHarnesses(root: string): Record<HarnessId, DevelopmentHarness> {
  const runner = new NodeProcessRunner();
  const installedClaude = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "pnpm", "bin", "claude.exe") : null;
  const claudeExecutable = installedClaude && existsSync(installedClaude) ? installedClaude : "claude";
  return {
    codex: new CodexHarness(runner, { executable: "codex" }, root),
    claude: new ClaudeHarness(runner, { executable: claudeExecutable }, root)
  };
}
import { existsSync } from "node:fs";
import { join } from "node:path";
