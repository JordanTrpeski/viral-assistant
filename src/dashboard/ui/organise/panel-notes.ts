import { h } from "../dom.js";
import type { OverviewPanel } from "./panel-types.js";

export const notesPanel: OverviewPanel = {
  id: "notes-lists", title: "Notes and lists", route: "organise-notes",
  render: (data) => h("div", { class: "panel-stats" },
    h("div", {}, h("strong", {}, String(data.notesAndLists.notes)), h("span", { class: "muted small" }, " notes")),
    h("div", {}, h("strong", {}, String(data.notesAndLists.lists)), h("span", { class: "muted small" }, " lists")),
    h("div", {}, h("strong", {}, String(data.notesAndLists.openRows)), h("span", { class: "muted small" }, ` of ${data.notesAndLists.rows} rows open`)))
};
