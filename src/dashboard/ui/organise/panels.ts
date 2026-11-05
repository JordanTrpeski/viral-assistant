// The Organise overview panels, in order. Adding a module's panel means adding it here, not editing the Overview.
import { notesPanel } from "./panel-notes.js";
import { remindersPanel } from "./panel-reminders.js";
import { reviewPanel } from "./panel-review.js";
import { tasksPanel } from "./panel-tasks.js";
import { trackersPanel } from "./panel-trackers.js";
import type { OverviewPanel } from "./panel-types.js";

export const overviewPanels: readonly OverviewPanel[] = [tasksPanel, remindersPanel, notesPanel, trackersPanel, reviewPanel];
