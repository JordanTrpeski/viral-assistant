import { h } from "../dom.js";
import type { OverviewPanel } from "./panel-types.js";

export const tasksPanel: OverviewPanel = {
  id: "tasks", title: "Tasks", route: "organise-tasks",
  render: (data) => h("div", { class: "panel-stats" },
    h("div", {}, h("strong", {}, String(data.tasks.open)), h("span", { class: "muted small" }, " open")),
    h("div", {}, h("strong", {}, String(data.tasks.dueThisWeek)), h("span", { class: "muted small" }, " due this week")),
    data.tasks.overdue ? h("div", { class: "overdue-flag" }, `${data.tasks.overdue} overdue`) : null)
};
