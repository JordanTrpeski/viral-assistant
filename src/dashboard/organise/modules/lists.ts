import { listPresets } from "../lists.js";
import type { OrganiseModule } from "./types.js";

export const listsModule: OrganiseModule = {
  type: "list_item",
  label: "Lists",
  fields: ["title", "list_id", "status", "notes", "links"],
  // Statuses come from each list.
  statuses: null,
  actions: [
    { name: "create_list", description: "Create a list with its own statuses or a preset.", fieldSchema: { name: { type: "text", required: true, description: "1 to 100 characters" }, preset: { type: "enum", required: false, description: "A preset set of status names", values: Object.keys(listPresets) } } },
    { name: "add_list_item", description: "Add a row to a list.", fieldSchema: { list_id: { type: "id", required: true, description: "An existing list" }, title: { type: "text", required: true, description: "1 to 200 characters" } } },
    { name: "set_list_item_status", description: "Move a row to another status of its list.", fieldSchema: { id: { type: "id", required: true, description: "The row" }, status: { type: "text", required: true, description: "One of its list's statuses" } } }
  ]
};
