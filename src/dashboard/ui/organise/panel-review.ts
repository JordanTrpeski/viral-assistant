import { h } from "../dom.js";
import type { OverviewPanel } from "./panel-types.js";

export const reviewPanel: OverviewPanel = {
  id: "review", title: "Weekly review", route: "organise-review",
  render: () => h("a", { class: "review-link", href: "#/organise-review" }, "Open the last 7 days →")
};
