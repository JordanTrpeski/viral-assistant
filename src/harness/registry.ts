import { ClaudeHarness } from "./claude.js";
import { CodexHarness } from "./codex.js";
import { NodeProcessRunner } from "./process.js";
import type { DevelopmentHarness, HarnessId } from "./types.js";

export function createHarnesses(root: string): Record<HarnessId, DevelopmentHarness> {
  const runner = new NodeProcessRunner();
  return {
    codex: new CodexHarness(runner, { executable: "codex" }, root),
    claude: new ClaudeHarness(runner, { executable: "claude" }, root)
  };
}

