import { h } from "../dom.js";
import type { OverviewPanel } from "./panel-types.js";

export const trackersPanel: OverviewPanel = {
  id: "trackers", title: "Trackers · this period", route: "organise-trackers",
  render: (data) => data.trackers.length
    ? h("div", { class: "item-list" }, ...data.trackers.map((tracker) => {
      const progress = tracker.progress;
      const text = progress.target === null ? `${progress.total}${tracker.unit ? ` ${tracker.unit}` : ""}` : `${progress.total} of ${progress.target}${tracker.unit ? ` ${tracker.unit}` : ""} · ${progress.percent}%`;
      return h("a", { class: "item-row", href: `#/organise-trackers?tracker=${tracker.id}` }, h("span", { class: "item-title" }, tracker.name), h("span", { class: "muted small" }, text));
    }))
    : h("p", { class: "muted small" }, "No trackers yet.")
};
