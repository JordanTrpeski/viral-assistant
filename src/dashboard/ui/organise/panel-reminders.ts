import { h } from "../dom.js";
import type { OverviewPanel } from "./panel-types.js";

export const remindersPanel: OverviewPanel = {
  id: "reminders", title: "Reminders · next 30 days", route: "organise-reminders",
  render: (data, context) => data.reminders.length
    ? h("div", { class: "item-list" }, ...data.reminders.slice(0, 8).map((entry) => h("button", { class: `item-row${entry.prepare ? " prepare" : ""}`, onclick: () => context.navigate(`organise-reminders?item=${entry.item_id}`) },
      h("span", { class: "item-title" }, entry.label), h("span", { class: "muted small" }, entry.date))),
      data.reminders.length > 8 ? h("p", { class: "muted small" }, `+${data.reminders.length - 8} more`) : null)
    : h("p", { class: "muted small" }, "Nothing in the next 30 days.")
};
