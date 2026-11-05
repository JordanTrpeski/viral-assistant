import { recurrences, reminderCategories } from "../model.js";
import type { OrganiseModule } from "./types.js";

const id = { type: "id", required: true, description: "The reminder's id" } as const;

export const remindersModule: OrganiseModule = {
  type: "reminder",
  label: "Reminders",
  fields: ["title", "date", "category", "project_id", "recurrence", "interval_days", "prepare_by", "notes", "links"],
  statuses: ["open", "done"],
  actions: [
    {
      name: "create_reminder", description: "Create a dated reminder; Personal ones prepare 14 days ahead by default.",
      fieldSchema: {
        title: { type: "text", required: true, description: "1 to 200 characters" },
        date: { type: "date", required: true, description: "YYYY-MM-DD" },
        category: { type: "enum", required: false, description: "Defaults to Other", values: reminderCategories },
        recurrence: { type: "enum", required: false, description: "Defaults to none", values: recurrences },
        interval_days: { type: "number", required: false, description: "1 to 365, for custom recurrence" },
        prepare_days: { type: "number", required: false, description: "Days before the date to prepare; 0 means none" }
      }
    },
    { name: "complete_reminder", description: "Mark a reminder done; a recurring one also creates its next occurrence.", fieldSchema: { id } },
    { name: "reopen_reminder", description: "Move a done reminder back to open.", fieldSchema: { id } }
  ]
};
