import type { Router } from "../http.js";
import { ValidationError } from "../errors.js";
import { requireDate, requireOneOf } from "../validation.js";
import { itemTypes, priorities, recurrences, reminderCategories, typeStatuses } from "./model.js";
import { organiseModules } from "./modules/registry.js";
import type { ItemFilter, OrganiseService } from "./service.js";
import { listPresets } from "./lists.js";
import { groupReminders } from "./reminders.js";
import { groupTasks } from "./tasks.js";

/** Organise routes: loopback JSON like the rest of the dashboard; 400 for validation, 404 for unknown ids. */
export function registerOrganiseRoutes(router: Router, organise: OrganiseService): void {
  // The model's fixed vocabularies, so the browser UI never duplicates them.
  router.add("GET", "/api/organise/meta", () => ({ types: itemTypes, statuses: typeStatuses, reminderCategories, recurrences, priorities, listPresets, modules: organiseModules }));
  router.add("GET", "/api/organise/reminders", async ({ query }) => groupReminders(await organise.listItems({ ...filterParams(query), type: "reminder" }), organise.today()));
  router.add("GET", "/api/organise/trackers", () => organise.listTrackers());
  router.add("POST", "/api/organise/trackers", ({ body }) => organise.createTracker(body));
  router.add("PATCH", "/api/organise/trackers/:id", ({ params, body }) => organise.updateTracker(params.id!, body));
  router.add("DELETE", "/api/organise/trackers/:id", ({ params }) => organise.deleteTracker(params.id!));
  router.add("GET", "/api/organise/trackers/:id/entries", ({ params }) => organise.listEntries(params.id!));
  router.add("POST", "/api/organise/trackers/:id/entries", ({ params, body }) => organise.addEntry(params.id!, body));
  router.add("PATCH", "/api/organise/trackers/:id/entries/:entryId", ({ params, body }) => organise.updateEntry(params.id!, params.entryId!, body));
  router.add("DELETE", "/api/organise/trackers/:id/entries/:entryId", ({ params }) => organise.deleteEntry(params.id!, params.entryId!));
  router.add("GET", "/api/organise/projects/:id", ({ params }) => organise.projectPage(params.id!));
  router.add("GET", "/api/organise/tasks", async ({ query }) => groupTasks(await organise.listItems({ ...filterParams(query), type: "task" }), organise.today()));
  router.add("GET", "/api/organise/items", ({ query }) => organise.listItems(filterParams(query)));
  router.add("POST", "/api/organise/items", ({ body }) => organise.createItem(body));
  router.add("GET", "/api/organise/items/:id", ({ params }) => organise.getItem(params.id!));
  router.add("PATCH", "/api/organise/items/:id", ({ params, body }) => organise.updateItem(params.id!, body));
  router.add("DELETE", "/api/organise/items/:id", ({ params }) => organise.deleteItem(params.id!));

  router.add("GET", "/api/organise/inbox", () => organise.inbox());
  router.add("POST", "/api/organise/inbox", ({ body }) => organise.addToInbox(body));
  router.add("POST", "/api/organise/inbox/:id/sort", ({ params, body }) => organise.sortInbox(params.id!, body), 200);

  router.add("GET", "/api/organise/lists", () => organise.listLists());
  router.add("POST", "/api/organise/lists", ({ body }) => organise.createList(body));
  router.add("GET", "/api/organise/lists/:id", ({ params }) => organise.getList(params.id!));
  router.add("PATCH", "/api/organise/lists/:id", ({ params, body }) => organise.updateList(params.id!, body));
  router.add("DELETE", "/api/organise/lists/:id", ({ params }) => organise.deleteList(params.id!));
}

/** Query filters: type, project_id, status, from, to (dates, inclusive). */
export function filterParams(query: URLSearchParams): ItemFilter {
  const filter: ItemFilter = {};
  const type = query.get("type");
  if (type) filter.type = requireOneOf(type, itemTypes, "type");
  const project = query.get("project_id");
  if (project) filter.project_id = project;
  const status = query.get("status");
  if (status) filter.status = status;
  const from = query.get("from");
  if (from) filter.from = requireDate(from, "from");
  const to = query.get("to");
  if (to) filter.to = requireDate(to, "to");
  if (filter.from && filter.to && filter.from > filter.to) throw new ValidationError("from must be on or before to");
  return filter;
}
