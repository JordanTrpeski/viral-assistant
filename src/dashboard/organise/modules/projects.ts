import type { OrganiseModule } from "./types.js";

export const projectsModule: OrganiseModule = {
  type: "project",
  label: "Projects",
  fields: ["title", "notes", "status", "links"],
  statuses: ["active", "paused", "done"],
  actions: [
    { name: "create_project", description: "Create a project with a name and description.", fieldSchema: { title: { type: "text", required: true, description: "Name, 1 to 100 characters" }, notes: { type: "text", required: false, description: "Description" } } },
    { name: "set_project_status", description: "Set a project to active, paused or done.", fieldSchema: { id: { type: "id", required: true, description: "The project" }, status: { type: "enum", required: true, description: "New status", values: ["active", "paused", "done"] } } },
    { name: "assign_to_project", description: "Put a task or reminder in a project.", fieldSchema: { id: { type: "id", required: true, description: "The task or reminder" }, project_id: { type: "id", required: true, description: "An existing project" } } }
  ]
};
