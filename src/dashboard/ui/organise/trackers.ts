// Trackers: progress for the current period, the last 8 periods, and live-editable entries.
import type { TrackerEntry, TrackerView } from "../../organise/trackers.js";
import { api, save, type AppContext } from "../api.js";
import { focusKey, h } from "../dom.js";
import type { OrganiseItem } from "./common.js";

const draft = { name: "", unit: "", target: "", period: "weekly" };
const entryDraft = { date: "", value: "", note: "" };
const trackerFilter = { project_id: "" };

function openTrackerId(): string | null {
  const match = /[?&]tracker=([0-9a-f-]{36})/.exec(location.hash);
  return match ? match[1]! : null;
}

function format(value: number, unit: string): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/\.?0+$/, "")}${unit ? ` ${unit}` : ""}`;
}

function periodLabel(tracker: TrackerView, start: string): string {
  if (tracker.period === "yearly") return start.slice(0, 4);
  if (tracker.period === "monthly") return start.slice(0, 7);
  return start.slice(5);
}

export function progressLine(tracker: TrackerView): HTMLElement {
  const progress = tracker.progress;
  if (progress.target === null) return h("div", { class: "tracker-progress" }, h("strong", {}, format(progress.total, tracker.unit)), h("span", { class: "muted small" }, ` this ${tracker.period.replace("ly", "")}`));
  const ratio = Math.min(1, progress.total / progress.target);
  return h("div", { class: "tracker-progress" },
    h("div", {}, h("strong", {}, `${format(progress.total, tracker.unit)} of ${format(progress.target, tracker.unit)}`), h("span", { class: "muted small" }, ` · ${progress.percent}% · ${format(progress.remaining ?? 0, tracker.unit)} to go`)),
    h("div", { class: "bar" }, h("div", { class: `bar-fill${ratio >= 1 ? " complete" : ""}`, style: `width:${Math.round(ratio * 100)}%` })));
}

async function trackerDetail(context: AppContext, tracker: TrackerView, projects: OrganiseItem[]): Promise<HTMLElement> {
  const entries = await api<TrackerEntry[]>("GET", `/api/organise/trackers/${tracker.id}/entries`);
  const patch = (body: Record<string, unknown>): Promise<void> => save(context, () => api("PATCH", `/api/organise/trackers/${tracker.id}`, body));
  const patchEntry = (entry: TrackerEntry, body: Record<string, unknown>): Promise<void> => save(context, () => api("PATCH", `/api/organise/trackers/${tracker.id}/entries/${entry.id}`, body));
  if (!entryDraft.date) entryDraft.date = context.today;
  const add = (): Promise<void> => {
    const value = Number(entryDraft.value);
    if (entryDraft.value.trim() === "" || !Number.isFinite(value) || value < 0) { context.notify("Enter a value of 0 or more"); return Promise.resolve(); }
    return save(context, async () => { await api("POST", `/api/organise/trackers/${tracker.id}/entries`, { date: entryDraft.date, value, ...(entryDraft.note ? { note: entryDraft.note } : {}) }); entryDraft.value = ""; entryDraft.note = ""; });
  };
  const numberInput = (value: number | null, key: string, onSave: (value: number | null) => Promise<void>, allowEmpty: boolean): HTMLInputElement => h("input", {
    ...focusKey(key), type: "number", min: 0, step: "any", class: "qty-input", value: value ?? "",
    onchange: (event: Event) => {
      const raw = (event.target as HTMLInputElement).value;
      if (raw === "" && allowEmpty) return onSave(null);
      const parsed = Number(raw);
      if (raw === "" || !Number.isFinite(parsed) || parsed < 0) { context.notify("Enter a number of 0 or more"); return; }
      return onSave(parsed);
    }
  });
  return h("div", { class: "tracker-detail" },
    h("div", { class: "toolbar" },
      h("input", { ...focusKey(`t:${tracker.id}:name`), value: tracker.name, maxlength: 100, onchange: (event: Event) => patch({ name: (event.target as HTMLInputElement).value }) }),
      h("input", { ...focusKey(`t:${tracker.id}:unit`), value: tracker.unit, placeholder: "unit", maxlength: 30, class: "unit-input", onchange: (event: Event) => patch({ unit: (event.target as HTMLInputElement).value }) }),
      h("span", { class: "muted small" }, "target"),
      numberInput(tracker.target, `t:${tracker.id}:target`, (value) => patch({ target: value === 0 ? null : value }), true),
      h("select", { ...focusKey(`t:${tracker.id}:period`), value: tracker.period, onchange: (event: Event) => patch({ period: (event.target as HTMLSelectElement).value }) },
        ...["weekly", "monthly", "yearly"].map((period) => h("option", { value: period }, period))),
      h("select", { ...focusKey(`t:${tracker.id}:project`), value: tracker.project_id ?? "", onchange: (event: Event) => patch({ project_id: (event.target as HTMLSelectElement).value || null }) },
        h("option", { value: "" }, "No project"), ...projects.map((project) => h("option", { value: project.id }, project.title))),
      h("span", { class: "spacer" }),
      h("button", { class: "danger", onclick: () => save(context, async () => { await api("DELETE", `/api/organise/trackers/${tracker.id}`); context.navigate("organise-trackers"); }) }, "Delete tracker")),
    h("div", { class: "history", title: "Totals for the last 8 periods" }, ...tracker.history.map((period) => h("div", { class: "history-cell" }, h("div", { class: "muted small" }, periodLabel(tracker, period.start)), h("div", {}, format(period.total, ""))))),
    h("div", { class: "inline-add" },
      h("input", { type: "date", "aria-label": "Entry date", value: entryDraft.date, onchange: (event: Event) => { entryDraft.date = (event.target as HTMLInputElement).value; } }),
      h("input", { ...focusKey(`t:${tracker.id}:new`), type: "number", min: 0, step: "any", placeholder: `value${tracker.unit ? ` (${tracker.unit})` : ""}`, value: entryDraft.value, oninput: (event: Event) => { entryDraft.value = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void add(); } }),
      h("input", { placeholder: "note (optional)", maxlength: 500, value: entryDraft.note, oninput: (event: Event) => { entryDraft.note = (event.target as HTMLInputElement).value; } }),
      h("button", { class: "primary", onclick: add }, "Add entry")),
    entries.length ? h("table", { class: "grid-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", {}, "Value"), h("th", {}, "Note"), h("th", {}, ""))),
      h("tbody", {}, ...entries.map((entry) => h("tr", {},
        h("td", {}, h("input", { ...focusKey(`e:${entry.id}:date`), type: "date", value: entry.date, onchange: (event: Event) => patchEntry(entry, { date: (event.target as HTMLInputElement).value }) })),
        h("td", {}, numberInput(entry.value, `e:${entry.id}:value`, (value) => patchEntry(entry, { value }), false)),
        h("td", {}, h("input", { ...focusKey(`e:${entry.id}:note`), value: entry.note, maxlength: 500, onchange: (event: Event) => patchEntry(entry, { note: (event.target as HTMLInputElement).value }) })),
        h("td", { class: "actions" }, h("button", { class: "danger", onclick: () => save(context, () => api("DELETE", `/api/organise/trackers/${tracker.id}/entries/${entry.id}`)) }, "Delete"))))))
      : h("p", { class: "muted small" }, "No entries yet."));
}

export async function renderTrackers(container: HTMLElement, context: AppContext): Promise<void> {
  const [trackers, items] = await Promise.all([api<TrackerView[]>("GET", "/api/organise/trackers"), api<OrganiseItem[]>("GET", "/api/organise/items?type=project")]);
  const openId = openTrackerId();
  const create = (): Promise<void> => {
    if (!draft.name.trim()) return Promise.resolve();
    const target = draft.target.trim() === "" ? null : Number(draft.target);
    return save(context, async () => {
      const tracker = await api<TrackerView>("POST", "/api/organise/trackers", { name: draft.name, unit: draft.unit, target, period: draft.period });
      draft.name = ""; draft.unit = ""; draft.target = "";
      context.navigate(`organise-trackers?tracker=${tracker.id}`);
    });
  };
  const shown = trackers.filter((tracker) => !trackerFilter.project_id || tracker.project_id === trackerFilter.project_id);
  const cards = await Promise.all(shown.map(async (tracker) => h("section", { class: `panel tracker${tracker.id === openId ? " open" : ""}` },
    h("div", { class: "panel-head" },
      h("a", { href: tracker.id === openId ? "#/organise-trackers" : `#/organise-trackers?tracker=${tracker.id}`, class: "tracker-name" }, tracker.name),
      h("span", { class: "muted small" }, `${tracker.period}${tracker.project_id ? ` · ${items.find((project) => project.id === tracker.project_id)?.title ?? ""}` : ""}`)),
    progressLine(tracker),
    tracker.id === openId ? await trackerDetail(context, tracker, items) : null)));
  container.replaceChildren(h("div", { class: "page organise" },
    h("div", { class: "organise-main" },
      h("section", { class: "panel" },
        h("div", { class: "inline-add" },
          h("input", { placeholder: "New tracker, e.g. Running", maxlength: 100, value: draft.name, oninput: (event: Event) => { draft.name = (event.target as HTMLInputElement).value; }, onkeydown: (event: KeyboardEvent) => { if (event.key === "Enter") void create(); } }),
          h("input", { class: "unit-input", placeholder: "unit", maxlength: 30, value: draft.unit, oninput: (event: Event) => { draft.unit = (event.target as HTMLInputElement).value; } }),
          h("input", { class: "unit-input", type: "number", min: 0, step: "any", placeholder: "target", value: draft.target, oninput: (event: Event) => { draft.target = (event.target as HTMLInputElement).value; } }),
          h("select", { value: draft.period, onchange: (event: Event) => { draft.period = (event.target as HTMLSelectElement).value; } }, ...["weekly", "monthly", "yearly"].map((period) => h("option", { value: period }, period))),
          h("button", { class: "primary", onclick: create }, "Add tracker")),
        h("div", { class: "toolbar filters" },
          h("select", { "aria-label": "Project", value: trackerFilter.project_id, onchange: (event: Event) => { trackerFilter.project_id = (event.target as HTMLSelectElement).value; void context.refresh(); } },
            h("option", { value: "" }, "All projects"), ...items.map((project) => h("option", { value: project.id }, project.title))),
          h("span", { class: "muted small" }, "Trackers have no status or date of their own; their entries are dated."))),
      ...(cards.length ? cards : [h("p", { class: "muted" }, "No trackers yet.")]))));
}
