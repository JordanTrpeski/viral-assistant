import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DevelopmentState } from "../src/types.js";

const run = promisify(execFile);
const documents = ["PRODUCT.md", "PRINCIPLES.md", "RULES.md", "EFFICIENCY.md", "ARCHITECTURE.md", "ROADMAP.md", "DECISIONS.md", "STATE.md"];

export const validState: DevelopmentState = {
  schemaVersion: 1,
  project: "Jarvis",
  currentMilestone: "M00_BOOTSTRAP",
  milestoneStatus: "in_progress",
  activeTask: null,
  completedTasks: [],
  blockers: [],
  lastVerifiedCommit: null,
  lastCheckpoint: null,
  nextAction: "Continue M00.",
  notes: []
};

export async function fixture(options: { git?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "jarvis-m00-"));
  await mkdir(join(root, "milestones"), { recursive: true });
  await mkdir(join(root, "tasks"), { recursive: true });
  for (const document of documents) await writeFile(join(root, document), `# ${document}\n`, "utf8");
  await writeFile(join(root, "milestones", "M00_BOOTSTRAP.md"), "# M00\n", "utf8");
  await writeFile(join(root, "STATE.json"), `${JSON.stringify(validState, null, 2)}\n`, "utf8");
  if (options.git) {
    await run("git", ["init", "-b", "main"], { cwd: root });
    await run("git", ["config", "user.name", "M00 Test"], { cwd: root });
    await run("git", ["config", "user.email", "m00@example.invalid"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-m", "fixture"], { cwd: root });
  }
  return root;
}

export async function copyRootFile(sourceRoot: string, targetRoot: string, path: string): Promise<void> {
  await cp(join(sourceRoot, path), join(targetRoot, path));
}

