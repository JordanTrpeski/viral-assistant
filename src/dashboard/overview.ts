import { itemsInWindow } from "./calendar.js";
import { addDays, type IsoDate } from "./shared/dates.js";
import { sortTimeline, type TimelineItem } from "./timeline.js";

/** Days covered by the "Next 7 days" panel, starting today. */
export const nextDays = 7;
/** How far ahead the Overview's Reminders panel looks. */
export const reminderHorizonDays = 30;
export const reminderPanelLimit = 8;

export interface ReminderPanelItem extends TimelineItem {
  overdue: boolean;
}

/** Today and the six days after it. */
export function nextSevenDays(items: TimelineItem[], today: IsoDate): TimelineItem[] {
  return itemsInWindow(items, today, nextDays);
}

/**
 * Open reminders and prepare-by entries: anything not done that is overdue or due within the next 30 days,
 * soonest first, at most eight.
 */
export function reminderPanel(items: TimelineItem[], today: IsoDate): ReminderPanelItem[] {
  const horizon = addDays(today, reminderHorizonDays);
  return sortTimeline(items.filter((item) => (item.source === "reminder" || item.source === "prepare") && item.status !== "done" && item.date <= horizon))
    .slice(0, reminderPanelLimit)
    .map((item) => ({ ...item, overdue: item.date < today }));
}
