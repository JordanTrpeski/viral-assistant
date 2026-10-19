// Project page: the project plus its items in sections, open items first.
import type { OrganiseItem } from "./model.js";
import type { OrganiseList } from "./service.js";

/** A tracker as the project page needs it (trackers arrive in a later step; until then the section is empty). */
export interface ProjectTracker {
  id: string;
  name: string;
  project_id: string | null;
}

export interface ProjectPage {
  project: OrganiseItem;
  sections: {
    tasks: OrganiseItem[];
    reminders: OrganiseItem[];
    notes: OrganiseItem[];
    trackers: ProjectTracker[];
    lists: { list: OrganiseList; rows: OrganiseItem[] }[];
  };
  counts: { open: number; total: number };
}

function isOpen(item: OrganiseItem, lists: readonly OrganiseList[]): boolean {
  if (item.type === "list_item") return item.status !== lists.find((list) => list.id === item.list_id)?.statuses.at(-1);
  return item.done_at === null;
}

/** Open first; within each half by date (undated last), then title. */
function openFirst(items: OrganiseItem[], lists: readonly OrganiseList[]): OrganiseItem[] {
  return items.sort((left, right) => Number(!isOpen(left, lists)) - Number(!isOpen(right, lists))
    || (left.date ?? "9999-12-31").localeCompare(right.date ?? "9999-12-31") || left.title.localeCompare(right.title));
}

export function projectPage(project: OrganiseItem, items: readonly OrganiseItem[], lists: readonly OrganiseList[], trackers: readonly ProjectTracker[] = []): ProjectPage {
  const mine = items.filter((item) => item.project_id === project.id);
  const of = (type: OrganiseItem["type"]): OrganiseItem[] => openFirst(mine.filter((item) => item.type === type), lists);
  const rows = of("list_item");
  const listIds = [...new Set(rows.map((row) => row.list_id))];
  const countable = mine.filter((item) => item.type !== "note");
  return {
    project,
    sections: {
      tasks: of("task"),
      reminders: of("reminder"),
      notes: mine.filter((item) => item.type === "note").sort((left, right) => right.created_at.localeCompare(left.created_at)),
      trackers: trackers.filter((tracker) => tracker.project_id === project.id),
      lists: listIds.map((id) => ({ list: lists.find((list) => list.id === id)!, rows: rows.filter((row) => row.list_id === id) })).filter((entry) => entry.list)
    },
    counts: { open: countable.filter((item) => isOpen(item, lists)).length, total: countable.length }
  };
}
