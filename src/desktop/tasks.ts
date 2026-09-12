import { listTasks } from "../tasks.js";
import { toDesktopTaskSummary, type DesktopTaskSummary } from "./types.js";

/** Projects every persisted development task into the left-sidebar task-queue shape, newest first. */
export async function projectTaskQueue(root: string): Promise<DesktopTaskSummary[]> {
  const tasks = await listTasks(root);
  return tasks.map(toDesktopTaskSummary).sort((left, right) => right.id.localeCompare(left.id));
}
