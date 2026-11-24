// Organise Export (phase 4): download every item from the new calendar store as CSV.
import { h } from "./dom.js";

export async function renderCalendarExport(container: HTMLElement): Promise<void> {
  container.replaceChildren(h("div", { class: "page cal-export" },
    h("h2", {}, "Export"),
    h("div", { class: "panel" },
      h("p", {}, "Download all tasks and reminders as a CSV file."),
      h("a", { class: "button primary", href: "/api/calendar/export.csv", download: "calendar-export.csv" }, "Download CSV"))));
}
