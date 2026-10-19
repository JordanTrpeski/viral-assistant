// Filter bar shared by the Organise subpanels: project, status and a date range.
import type { AppContext } from "../api.js";
import { h } from "../dom.js";
import { statusLabel, type OrganiseItem } from "./common.js";

export interface FilterState {
  project_id: string;
  status: string;
  from: string;
  to: string;
}

export function emptyFilters(): FilterState {
  return { project_id: "", status: "", from: "", to: "" };
}

export function filterQuery(filters: FilterState, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function filterBar(context: AppContext, filters: FilterState, projects: OrganiseItem[], statuses: readonly string[] | null, dateLabel = "Date"): HTMLElement {
  const set = (key: keyof FilterState) => (event: Event): void => { filters[key] = (event.target as HTMLInputElement | HTMLSelectElement).value; void context.refresh(); };
  const active = Object.values(filters).some(Boolean);
  return h("div", { class: "toolbar filters" },
    h("select", { "aria-label": "Project", value: filters.project_id, onchange: set("project_id") },
      h("option", { value: "" }, "All projects"), ...projects.map((project) => h("option", { value: project.id }, project.title))),
    statuses ? h("select", { "aria-label": "Status", value: filters.status, onchange: set("status") },
      h("option", { value: "" }, "Any status"), ...statuses.map((status) => h("option", { value: status }, statusLabel(status)))) : null,
    h("span", { class: "muted small" }, `${dateLabel} from`),
    h("input", { type: "date", "aria-label": `${dateLabel} from`, value: filters.from, onchange: set("from") }),
    h("span", { class: "muted small" }, "to"),
    h("input", { type: "date", "aria-label": `${dateLabel} to`, value: filters.to, onchange: set("to") }),
    active ? h("button", { onclick: () => { Object.assign(filters, emptyFilters()); void context.refresh(); } }, "Clear filters") : null);
}
