// Auto-suggest chips on inbox items, and the suggestion settings shown on the Settings page.
import type { Suggestion } from "../../organise/suggest.js";
import { api, save, type AppContext } from "../api.js";
import { focusKey, h } from "../dom.js";
import type { OrganiseItem } from "./common.js";
import { startSort } from "./inbox.js";

export type InboxItem = OrganiseItem & { suggestions: Suggestion[] };

/** Accept opens the sort form pre-filled with the suggested type; nothing is applied until Save. */
export function suggestionChips(context: AppContext, item: InboxItem | undefined): HTMLElement | null {
  if (!item || !item.suggestions.length) return null;
  return h("span", { class: "suggestions" }, ...item.suggestions.map((suggestion) => h("span", { class: "suggestion-chip", title: `Suggested from ${suggestion.pattern}` },
    h("span", {}, suggestion.label),
    h("button", {
      class: "chip-accept", "aria-label": `Accept: ${suggestion.label}`,
      onclick: () => save(context, async () => {
        const accepted = await api<{ type: "task" | "reminder"; prefill: { date: string | null } }>("POST", `/api/organise/suggest/${item.id}/accept`, { pattern: suggestion.pattern });
        startSort(item, accepted.type, context.today, accepted.prefill);
      })
    }, "Accept"),
    h("button", {
      class: "chip-dismiss", "aria-label": `Dismiss: ${suggestion.label}`,
      onclick: () => save(context, async () => {
        const result = await api<{ muted: boolean; pattern: string }>("POST", `/api/organise/suggest/${item.id}/dismiss`, { pattern: suggestion.pattern });
        if (result.muted) context.notify(`Muted ${result.pattern} after three dismissals in a row. Unmute it in Settings.`);
      })
    }, "Dismiss"))));
}

interface Rules {
  verbs: string[];
  datePatterns: Record<string, boolean>;
  datePatternLabels: Record<string, string>;
  muted: string[];
}

export async function suggestionSettings(context: AppContext): Promise<HTMLElement> {
  const rules = await api<Rules>("GET", "/api/organise/rules");
  return h("section", { class: "panel narrow" },
    h("h3", {}, "Organise suggestions"),
    h("label", { class: "organise-field" }, h("span", {}, "Task verbs"),
      h("textarea", {
        ...focusKey("rules-verbs"), class: "organise-textarea", rows: 3, value: rules.verbs.join(", "),
        onchange: (event: Event) => save(context, () => api("PATCH", "/api/organise/rules", { verbs: (event.target as HTMLTextAreaElement).value.split(/[\s,]+/).map((verb) => verb.trim()).filter(Boolean) }))
      })),
    h("p", { class: "muted small" }, "An inbox item whose first word is one of these suggests a task."),
    h("div", { class: "organise-field" }, h("span", {}, "Date patterns"),
      h("div", { class: "toggles" }, ...Object.entries(rules.datePatterns).map(([name, on]) => h("label", { class: "toggle" },
        h("input", { type: "checkbox", checked: on, onchange: (event: Event) => save(context, () => api("PATCH", "/api/organise/rules", { datePatterns: { [name]: (event.target as HTMLInputElement).checked } })) }),
        rules.datePatternLabels[name] ?? name)))),
    h("div", { class: "organise-field" }, h("span", {}, "Muted"),
      rules.muted.length
        ? h("div", { class: "toggles" }, ...rules.muted.map((pattern) => h("span", { class: "link-chip" }, pattern,
          h("button", { onclick: () => save(context, () => api("POST", `/api/organise/suggest/${encodeURIComponent(pattern)}/unmute`)) }, "Unmute"))))
        : h("span", { class: "muted small" }, "Nothing muted. A pattern is muted after three dismissals in a row.")));
}
