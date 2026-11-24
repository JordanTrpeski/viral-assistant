// Organise Search (phase 4): case-insensitive title search over the new calendar store.
import { api, type AppContext } from "./api.js";
import { h } from "./dom.js";
import { kindLabel } from "../shared/kind-labels.js";

interface FoundItem { id: string; kind: string; title: string; date: string; time: string | null; status: string; }

export async function renderCalendarSearch(container: HTMLElement, _context: AppContext): Promise<void> {
  const input = h("input", { type: "search", placeholder: "Search titles…", class: "grow" });
  const results = h("div", { class: "panel" }, h("p", { class: "muted small" }, "Type to search."));

  const run = async (): Promise<void> => {
    const query = (input as HTMLInputElement).value.trim();
    if (query === "") { results.replaceChildren(h("p", { class: "muted small" }, "Type to search.")); return; }
    try {
      const data = await api<{ items: FoundItem[] }>("GET", `/api/calendar/search?q=${encodeURIComponent(query)}`);
      results.replaceChildren(
        h("h3", {}, `Results (${data.items.length})`),
        ...(data.items.length
          ? data.items.map((item) => h("div", { class: `cal-row item${item.status === "done" ? " done" : ""}` },
            h("span", { class: "cal-when" }, item.date), h("span", { class: "cal-title" }, item.title), h("span", { class: "cal-tag" }, kindLabel(item.kind))))
          : [h("p", { class: "muted small" }, "No matches.")]));
    } catch (error) { results.replaceChildren(h("p", { class: "muted small" }, (error as Error).message)); }
  };

  input.addEventListener("input", () => { void run(); });
  container.replaceChildren(h("div", { class: "page cal-search" },
    h("h2", {}, "Search"),
    h("div", { class: "panel addbar" }, input, h("button", { class: "primary", onclick: run }, "Search")),
    results));
}
