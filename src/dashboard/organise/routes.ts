import type { Router } from "../http.js";
import { requireOneOf } from "../validation.js";
import { itemTypes, priorities, recurrences, reminderCategories, typeStatuses } from "./model.js";
import type { OrganiseService } from "./service.js";

/** Organise routes: loopback JSON like the rest of the dashboard; 400 for validation, 404 for unknown ids. */
export function registerOrganiseRoutes(router: Router, organise: OrganiseService): void {
  // The model's fixed vocabularies, so the browser UI never duplicates them.
  router.add("GET", "/api/organise/meta", () => ({ types: itemTypes, statuses: typeStatuses, reminderCategories, recurrences, priorities }));
  router.add("GET", "/api/organise/items", ({ query }) => {
    const type = query.get("type");
    return organise.listItems(type === null ? {} : { type: requireOneOf(type, itemTypes, "type") });
  });
  router.add("POST", "/api/organise/items", ({ body }) => organise.createItem(body));
  router.add("GET", "/api/organise/items/:id", ({ params }) => organise.getItem(params.id!));
  router.add("PATCH", "/api/organise/items/:id", ({ params, body }) => organise.updateItem(params.id!, body));
  router.add("DELETE", "/api/organise/items/:id", ({ params }) => organise.deleteItem(params.id!));

  router.add("GET", "/api/organise/inbox", () => organise.inbox());
  router.add("POST", "/api/organise/inbox", ({ body }) => organise.addToInbox(body));
  router.add("POST", "/api/organise/inbox/:id/sort", ({ params, body }) => organise.sortInbox(params.id!, body), 200);

  router.add("GET", "/api/organise/lists", () => organise.listLists());
}
