import { trackerPeriods } from "../trackers.js";
import type { OrganiseModule } from "./types.js";

export const trackersModule: OrganiseModule = {
  type: "tracker",
  label: "Trackers",
  fields: ["name", "unit", "target", "period", "project_id"],
  statuses: null,
  actions: [
    {
      name: "create_tracker", description: "Track a quantity per week, month or year, with an optional target.",
      fieldSchema: {
        name: { type: "text", required: true, description: "1 to 100 characters" },
        unit: { type: "text", required: false, description: "e.g. km, pages, hours" },
        target: { type: "number", required: false, description: "Greater than 0; omit for no target" },
        period: { type: "enum", required: true, description: "Period the target applies to", values: trackerPeriods }
      }
    },
    {
      name: "log_entry", description: "Add an entry to a tracker.",
      fieldSchema: { tracker_id: { type: "id", required: true, description: "The tracker" }, value: { type: "number", required: true, description: "0 or more" }, date: { type: "date", required: false, description: "Defaults to today" } }
    }
  ]
};
