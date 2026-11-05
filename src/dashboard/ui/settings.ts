// Settings page: opening balance, read-only configuration, and Organise suggestion settings.
import { formatCents, parseEuroToCents } from "../shared/money.js";
import { api, save, type AppContext } from "./api.js";
import { focusKey, h } from "./dom.js";
import { suggestionSettings } from "./organise/suggest.js";

interface Settings {
  openingBalanceCents: number;
  budgetStepCents: number;
}

export async function renderSettings(container: HTMLElement, context: AppContext): Promise<void> {
  const [settings, suggestions] = await Promise.all([api<Settings>("GET", "/api/settings"), suggestionSettings(context)]);
  container.replaceChildren(h("div", { class: "page settings" },
    h("section", { class: "panel narrow" },
      h("h3", {}, "Finance"),
      h("label", { class: "field" },
        h("span", {}, "Opening balance (EUR)"),
        h("input", {
          ...focusKey("opening"), class: "amount-input", inputmode: "decimal", value: (settings.openingBalanceCents / 100).toFixed(2),
          onchange: (event: Event) => {
            const input = event.target as HTMLInputElement;
            const cents = parseEuroToCents(input.value);
            if (cents === null) {
              context.notify("Enter an amount such as 1500 or -20.50");
              input.value = (settings.openingBalanceCents / 100).toFixed(2);
              return;
            }
            return save(context, () => api("PATCH", "/api/settings", { openingBalanceCents: cents }));
          }
        })),
      h("p", { class: "muted small" }, "The balance before your first recorded transaction. It may be zero or negative."),
      h("div", { class: "field" }, h("span", {}, "Budget − / + step"), h("strong", {}, formatCents(settings.budgetStepCents))),
      h("p", { class: "muted small" }, "Set as dashboard.budgetStepCents in viral-dev.config.json; restart the dashboard after changing it.")),
    suggestions));
}
