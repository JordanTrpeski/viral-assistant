import { priorities } from "../model.js";
import type { OrganiseModule } from "./types.js";

const id = { type: "id", required: true, description: "The task's id" } as const;

export const tasksModule: OrganiseModule = {
  type: "task",
  label: "Tasks",
  fields: ["title", "date", "status", "priority", "project_id", "checklist", "notes", "links"],
  statuses: ["open", "in_progress", "done"],
  actions: [
    {
      name: "create_task", description: "Create a task with an optional due date, priority and project.",
      fieldSchema: {
        title: { type: "text", required: true, description: "1 to 200 characters" },
        date: { type: "date", required: false, description: "Due date, YYYY-MM-DD" },
        priority: { type: "enum", required: false, description: "Defaults to normal", values: priorities },
        project_id: { type: "id", required: false, description: "An existing project" }
      }
    },
    { name: "complete_task", description: "Mark a task done; it moves to Done and is never deleted.", fieldSchema: { id } },
    { name: "reopen_task", description: "Move a done task back to open.", fieldSchema: { id } },
    {
      name: "set_checklist_entry", description: "Tick or untick one checklist entry of a task.",
      fieldSchema: { id, entry_id: { type: "id", required: true, description: "The checklist entry" }, done: { type: "boolean", required: true, description: "Done state" } }
    }
  ]
};
