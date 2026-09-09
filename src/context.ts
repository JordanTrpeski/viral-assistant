import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadState } from "./state.js";

const requiredDocuments = ["PRODUCT.md", "PRINCIPLES.md", "RULES.md", "ARCHITECTURE.md", "ROADMAP.md", "DECISIONS.md", "STATE.md"] as const;

export interface ProjectContext {
  state: Awaited<ReturnType<typeof loadState>>;
  documents: Record<string, string>;
  milestonePath: string;
  milestone: string;
}

async function requiredText(root: string, path: string): Promise<string> {
  try {
    const text = await readFile(join(root, path), "utf8");
    if (text.trim() === "") throw new Error("file is empty");
    return text;
  } catch (error) {
    throw new Error(`Cannot load required context ${path}: ${(error as Error).message}`);
  }
}

export async function loadProjectContext(root: string): Promise<ProjectContext> {
  const state = await loadState(root);
  const documents: Record<string, string> = {};
  for (const path of requiredDocuments) documents[path] = await requiredText(root, path);
  const milestonePath = join("milestones", `${state.currentMilestone}.md`).replaceAll("\\", "/");
  const milestone = await requiredText(root, milestonePath);
  return { state, documents, milestonePath, milestone };
}

