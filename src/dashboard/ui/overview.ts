// Overview: the month calendar in the centre (right column arrives with the next milestone).
import type { AppContext } from "./api.js";
import { renderCalendar } from "./calendar.js";
import { h } from "./dom.js";

export async function renderOverview(container: HTMLElement, context: AppContext): Promise<void> {
  const calendar = await renderCalendar(context);
  container.replaceChildren(h("div", { class: "overview" }, calendar));
}
