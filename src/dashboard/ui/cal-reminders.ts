// Organise Reminders (phase 4): list and add reminders. Fields: title, category (optional), date, time or
// all-day, lead time in days. No writes to Google.
import { api, save, type AppContext } from "./api.js";
import { h } from "./dom.js";
import { loadCategories } from "./cal-common.js";

interface Reminder {
  id: string; title: string; date: string; time: string | null; allDay: boolean;
  categoryId: string | null; leadTimes: number[] | null;
}

export async function renderCalendarReminders(container: HTMLElement, context: AppContext): Promise<void> {
  const [reminders, categories] = await Promise.all([
    api<Reminder[]>("GET", "/api/calendar/items?kind=reminder"),
    loadCategories()
  ]);

  const title = h("input", { type: "text", placeholder: "New reminder", class: "grow" });
  const category = h("select", {}, h("option", { value: "" }, "No category"), ...categories.map((cat) => h("option", { value: cat.id }, cat.name)));
  const date = h("input", { type: "date" });
  const time = h("input", { type: "time", title: "Time (leave empty for all-day)" });
  const lead = h("input", { type: "number", min: "0", placeholder: "lead days", title: "Lead time in days", class: "narrow" });

  const add = async (): Promise<void> => {
    const text = (title as HTMLInputElement).value.trim();
    const day = (date as HTMLInputElement).value;
    if (text === "" || day === "") { context.notify("A reminder needs a title and a date."); return; }
    const timeValue = (time as HTMLInputElement).value;
    const leadValue = (lead as HTMLInputElement).value;
    await save(context, () => api("POST", "/api/calendar/items", {
      kind: "reminder", title: text, date: day,
      categoryId: (category as HTMLSelectElement).value || null,
      allDay: timeValue === "", time: timeValue === "" ? null : timeValue,
      leadTimes: leadValue === "" ? null : [Number(leadValue)]
    }));
  };

  const row = (reminder: Reminder): HTMLElement => h("div", { class: "cal-row item" },
    h("span", { class: "cal-when" }, reminder.allDay ? "all day" : reminder.time ?? ""),
    h("span", { class: "cal-title" }, reminder.title),
    h("span", { class: "cal-when" }, reminder.date),
    reminder.leadTimes && reminder.leadTimes.length ? h("span", { class: "cal-tag" }, `lead ${reminder.leadTimes.join(", ")}d`) : h("span", {}),
    reminder.categoryId ? h("span", { class: "cal-cat" }, categories.find((category) => category.id === reminder.categoryId)?.name ?? "") : h("span", {}));

  container.replaceChildren(h("div", { class: "page cal-reminders" },
    h("h2", {}, "Reminders"),
    h("div", { class: "panel addbar" }, title, category, date, time, lead, h("button", { class: "primary", onclick: add }, "Add")),
    h("div", { class: "panel" }, h("h3", {}, `Reminders (${reminders.length})`), ...(reminders.length ? reminders.map(row) : [h("p", { class: "muted small" }, "No reminders yet.")]))));
}
