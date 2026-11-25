// Organise Deleted (phase 6): the trash list. Deleted deadlines and events wait 7 days here before they are
// purged and their Google event is removed. Each entry has Restore and Delete now.
import { api, save, type AppContext } from "./api.js";
import { h } from "./dom.js";
import { kindLabel } from "../shared/kind-labels.js";

interface TrashRow {
  id: string; reason: "app" | "series" | "conflict"; deletedAt: string; expiresAt: string;
  title: string; kind: string; date: string; allDay: boolean; time: string | null;
}

const reasonLabel: Record<string, string> = { app: "deleted", series: "series", conflict: "conflict loser" };

export async function renderCalendarTrash(container: HTMLElement, context: AppContext): Promise<void> {
  const entries = await api<TrashRow[]>("GET", "/api/calendar/trash");

  const row = (entry: TrashRow): HTMLElement => h("div", { class: "cal-row item" },
    h("span", { class: "cal-title" }, entry.title),
    h("span", { class: "cal-tag" }, kindLabel(entry.kind)),
    h("span", { class: "cal-when" }, entry.allDay ? entry.date : `${entry.date} ${entry.time ?? ""}`.trim()),
    h("span", { class: "cal-cat" }, reasonLabel[entry.reason] ?? entry.reason),
    h("span", { class: "cal-when" }, `until ${entry.expiresAt.slice(0, 10)}`),
    h("button", { onclick: () => save(context, () => api("POST", `/api/calendar/trash/${entry.id}/restore`)) }, "Restore"),
    h("button", { class: "danger", onclick: () => save(context, () => api("POST", `/api/calendar/trash/${entry.id}/delete-now`)) }, "Delete now"));

  container.replaceChildren(h("div", { class: "page cal-trash" },
    h("h2", {}, "Deleted"),
    h("p", { class: "muted small" }, "Deleted deadlines and events wait 7 days here, then are removed and (if linked) deleted from your writable Google calendar. Restore puts an item back and re-syncs it. Read-only calendars are never touched."),
    h("div", { class: "panel" }, ...(entries.length ? entries.map(row) : [h("p", { class: "muted small" }, "Nothing deleted.")]))));
}
