import { addDays, type IsoDate } from "../shared/dates.js";
import type { OrganiseItem, Priority } from "./model.js";

export interface TaskView extends OrganiseItem {
  overdue: boolean;
  /** Checklist progress, "n of m". */
  progress: { done: number; total: number };
}

export interface TaskGroups {
  today: TaskView[];
  thisWeek: TaskView[];
  later: TaskView[];
  done: TaskView[];
}

const priorityRank: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export function isOpenTask(item: OrganiseItem): boolean {
  return item.type === "task" && item.status !== "done";
}

export function taskView(item: OrganiseItem, today: IsoDate): TaskView {
  const list = item.checklist ?? [];
  return { ...item, overdue: isOpenTask(item) && item.date !== null && item.date < today, progress: { done: list.filter((entry) => entry.done).length, total: list.length } };
}

function byDueThenPriority(left: TaskView, right: TaskView): number {
  return (left.date ?? "9999-12-31").localeCompare(right.date ?? "9999-12-31")
    || priorityRank[left.priority ?? "normal"] - priorityRank[right.priority ?? "normal"]
    || left.title.localeCompare(right.title);
}

/**
 * Today: open, due today or overdue. This week: open, due in the 6 days after today. Later: open, no date or due
 * later. Done: newest done_at first. "Open" means not done, so in_progress counts as open.
 */
export function groupTasks(items: readonly OrganiseItem[], today: IsoDate): TaskGroups {
  const tasks = items.filter((item) => item.type === "task").map((item) => taskView(item, today));
  const weekEnd = addDays(today, 6);
  const open = tasks.filter((task) => task.status !== "done");
  return {
    today: open.filter((task) => task.date !== null && task.date <= today).sort(byDueThenPriority),
    thisWeek: open.filter((task) => task.date !== null && task.date > today && task.date <= weekEnd).sort(byDueThenPriority),
    later: open.filter((task) => task.date === null || task.date > weekEnd).sort(byDueThenPriority),
    done: tasks.filter((task) => task.status === "done").sort((left, right) => (right.done_at ?? "").localeCompare(left.done_at ?? "") || left.title.localeCompare(right.title))
  };
}
