// Shared helpers for the Organise pages: API types, metadata, and small live-editing controls.
import type { ItemType, OrganiseItem } from "../../organise/model.js";
import { api, save, type AppContext } from "../api.js";
import { focusKey, h } from "../dom.js";

export type { ItemType, OrganiseItem };

export interface OrganiseMeta {
  types: ItemType[];
  statuses: Record<string, string[] | null>;
  reminderCategories: string[];
  recurrences: string[];
  priorities: string[];
}

let metaCache: OrganiseMeta | null = null;

export async function meta(): Promise<OrganiseMeta> {
  metaCache ??= await api<OrganiseMeta>("GET", "/api/organise/meta");
  return metaCache;
}

export const typeLabels: Record<ItemType, string> = {
  task: "Task", reminder: "Reminder", note: "Note", list_item: "List item", project: "Project", inbox: "Inbox"
};

export function patchItem(context: AppContext, id: string, body: Record<string, unknown>): Promise<void> {
  return save(context, () => api("PATCH", `/api/organise/items/${id}`, body));
}

/** A text input that saves on change; empty saves as null when `nullable`. */
export function textField(context: AppContext, value: string, key: string, onSave: (value: string | null) => Promise<void>, options: { placeholder?: string; nullable?: boolean; multiline?: boolean; maxlength?: number } = {}): HTMLElement {
  const handler = (event: Event): Promise<void> => {
    const raw = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    return onSave(options.nullable && raw.trim() === "" ? null : raw);
  };
  const shared = { ...focusKey(key), value, placeholder: options.placeholder ?? "", ...(options.maxlength ? { maxlength: options.maxlength } : {}), onchange: handler };
  return options.multiline ? h("textarea", { ...shared, rows: 4, class: "organise-textarea" }) : h("input", shared);
}

export function dateField(context: AppContext, value: string | null, key: string, onSave: (value: string | null) => Promise<void>): HTMLInputElement {
  return h("input", { ...focusKey(key), type: "date", value: value ?? "", onchange: (event: Event) => onSave((event.target as HTMLInputElement).value || null) });
}

export function selectField(value: string | null, options: { value: string; label: string }[], key: string, onSave: (value: string | null) => Promise<void>, allowNone = false): HTMLSelectElement {
  return h("select", { ...focusKey(key), value: value ?? "", onchange: (event: Event) => onSave((event.target as HTMLSelectElement).value || null) },
    allowNone ? h("option", { value: "" }, "None") : null,
    ...options.map((option) => h("option", { value: option.value }, option.label)));
}

export function field(label: string, control: Node): HTMLElement {
  return h("label", { class: "organise-field" }, h("span", {}, label), control);
}

export function statusLabel(status: string | null): string {
  return status === null ? "" : status.replace("_", " ");
}

export function isOverdue(item: OrganiseItem, today: string): boolean {
  return item.date !== null && item.date < today && item.done_at === null && item.status !== null;
}
