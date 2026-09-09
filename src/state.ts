import { join } from "node:path";
import { readJson, writeJson } from "./files.js";
import type { DevelopmentState } from "./types.js";
import { validateState } from "./validation.js";

export async function loadState(root: string): Promise<DevelopmentState> {
  return validateState(await readJson(join(root, "STATE.json")));
}

export async function saveState(root: string, state: DevelopmentState): Promise<void> {
  await writeJson(join(root, "STATE.json"), validateState(state));
}

