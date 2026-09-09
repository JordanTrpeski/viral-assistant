import { join } from "node:path";
import { readJson, writeJson } from "./files.js";
import type { DevelopmentTask } from "./types.js";
import { validateTask } from "./validation.js";

function taskPath(root: string, id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid task id: ${id}`);
  return join(root, "tasks", `${id}.json`);
}

export async function readTask(root: string, id: string): Promise<DevelopmentTask> {
  return validateTask(await readJson(taskPath(root, id)), `task ${id}`);
}

export async function saveTask(root: string, task: DevelopmentTask): Promise<void> {
  await writeJson(taskPath(root, task.id), validateTask(task, `task ${task.id}`));
}

export async function updateTask(root: string, id: string, changes: Partial<DevelopmentTask>): Promise<DevelopmentTask> {
  const updated = validateTask({ ...await readTask(root, id), ...changes, id }, `task ${id}`);
  await saveTask(root, updated);
  return updated;
}

