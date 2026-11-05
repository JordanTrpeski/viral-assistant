// Auto-suggest for inbox items. Plain code, no model: a date signal suggests a reminder, a leading verb a task.
import { ValidationError } from "../errors.js";
import { addDays, isIsoDate, weekdayMondayFirst, type IsoDate } from "../shared/dates.js";
import { isObject, rejectUnknownFields, requireObject } from "../validation.js";
import type { OrganiseItem } from "./model.js";

export const defaultVerbs = ["call", "email", "buy", "read", "revise", "finish", "book", "pay", "send", "renew", "write", "check", "fix", "clean", "cook", "practice", "study", "submit", "prepare", "plan"] as const;

export const datePatternNames = ["iso", "d_mon", "mon_d", "weekday", "today", "tomorrow", "on_the_nth"] as const;
export type DatePatternName = typeof datePatternNames[number];

export const datePatternLabels: Record<DatePatternName, string> = {
  iso: "ISO date (2026-10-20)", d_mon: "\"d Mon\" (20 Oct)", mon_d: "\"Mon d\" (Oct 20)", weekday: "Weekday name (friday)",
  today: "\"today\"", tomorrow: "\"tomorrow\"", on_the_nth: "\"on the Nth\" (on the 3rd)"
};

/** Three dismissals in a row of the same pattern mute it. */
export const muteAfter = 3;

export interface PatternStats {
  accepts: number;
  dismisses: number;
  /** Dismissals since the last accept; reaching three mutes the pattern. */
  consecutiveDismissals: number;
  muted: boolean;
}

export interface RulesDocument {
  schemaVersion: 1;
  verbs: string[];
  datePatterns: Record<DatePatternName, boolean>;
  /** Keyed by pattern, e.g. "date:weekday" or "verb:buy". */
  patterns: Record<string, PatternStats>;
  /** Suggestions dismissed for a particular inbox item, so the chip stays hidden for that item. */
  dismissed: { item_id: string; pattern: string }[];
}

export interface Suggestion {
  type: "reminder" | "task";
  pattern: string;
  label: string;
  /** Pre-fill for the sort form. */
  date: IsoDate | null;
}

export function emptyRules(): RulesDocument {
  return {
    schemaVersion: 1, verbs: [...defaultVerbs],
    datePatterns: Object.fromEntries(datePatternNames.map((name) => [name, true])) as Record<DatePatternName, boolean>,
    patterns: {}, dismissed: []
  };
}

export function validateRulesDocument(value: unknown): RulesDocument {
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.verbs) || !isObject(value.datePatterns) || !isObject(value.patterns) || !Array.isArray(value.dismissed)) {
    throw new Error("organise rules must be an object with schemaVersion 1, verbs, datePatterns, patterns and dismissed");
  }
  const defaults = emptyRules().datePatterns;
  return { ...(value as unknown as RulesDocument), datePatterns: { ...defaults, ...(value.datePatterns as Record<DatePatternName, boolean>) } };
}

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const monthWord = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";

/** The next date (on or after today) with this month and day; null if the day never exists in that month. */
function nextMonthDay(month: number, day: number, today: IsoDate): IsoDate | null {
  const year = Number(today.slice(0, 4));
  for (const candidate of [year, year + 1, year + 2, year + 3, year + 4]) {
    const date = `${candidate}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (isIsoDate(date) && date >= today) return date;
  }
  return null;
}

/** "on the Nth": this month if still to come, otherwise the next month that has that day. */
function nextNth(day: number, today: IsoDate): IsoDate | null {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let step = 0; step < 13; step += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (isIsoDate(date) && date >= today) return date;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return null;
}

/** Finds the first enabled date pattern in the text and the date it points to. */
export function detectDate(text: string, today: IsoDate, enabled: Record<DatePatternName, boolean>): { pattern: DatePatternName; date: IsoDate } | null {
  const lower = text.toLowerCase();
  const checks: [DatePatternName, () => IsoDate | null][] = [
    ["iso", () => { const match = /\b(\d{4}-\d{2}-\d{2})\b/.exec(lower); return match && isIsoDate(match[1]) ? match[1]! : null; }],
    ["d_mon", () => { const match = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthWord}\\b`).exec(lower); return match ? nextMonthDay(months.indexOf(match[2]!) + 1, Number(match[1]), today) : null; }],
    ["mon_d", () => { const match = new RegExp(`\\b${monthWord}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(lower); return match ? nextMonthDay(months.indexOf(match[1]!) + 1, Number(match[2]), today) : null; }],
    ["today", () => (/\btoday\b/.test(lower) ? today : null)],
    ["tomorrow", () => (/\btomorrow\b/.test(lower) ? addDays(today, 1) : null)],
    ["on_the_nth", () => { const match = /\bon the (\d{1,2})(?:st|nd|rd|th)\b/.exec(lower); return match ? nextNth(Number(match[1]), today) : null; }],
    ["weekday", () => {
      const match = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(lower);
      if (!match) return null;
      return addDays(today, (weekdays.indexOf(match[1]!) - weekdayMondayFirst(today) + 7) % 7);
    }]
  ];
  for (const [pattern, find] of checks) {
    if (!enabled[pattern]) continue;
    const date = find();
    if (date) return { pattern, date };
  }
  return null;
}

export function leadingVerb(text: string, verbs: readonly string[]): string | null {
  const first = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z'-]/g, "") ?? "";
  return first && verbs.includes(first) ? first : null;
}

/**
 * Suggestions for one inbox item: a date suggests a reminder; a leading verb suggests a task; with both, the
 * reminder comes first and the task is the second option. Muted and already-dismissed patterns are left out.
 */
export function suggestionsFor(item: OrganiseItem, rules: RulesDocument, today: IsoDate): Suggestion[] {
  if (item.type !== "inbox") return [];
  const hidden = (pattern: string): boolean => rules.patterns[pattern]?.muted === true || rules.dismissed.some((entry) => entry.item_id === item.id && entry.pattern === pattern);
  const suggestions: Suggestion[] = [];
  const date = detectDate(item.title, today, rules.datePatterns);
  if (date && !hidden(`date:${date.pattern}`)) suggestions.push({ type: "reminder", pattern: `date:${date.pattern}`, label: `Reminder on ${date.date}`, date: date.date });
  const verb = leadingVerb(item.title, rules.verbs);
  if (verb && !hidden(`verb:${verb}`)) suggestions.push({ type: "task", pattern: `verb:${verb}`, label: "Task", date: null });
  return suggestions;
}

export function rulesPatch(body: unknown): { verbs?: string[]; datePatterns?: Partial<Record<DatePatternName, boolean>> } {
  const input = requireObject(body);
  rejectUnknownFields(input, ["verbs", "datePatterns"]);
  const patch: { verbs?: string[]; datePatterns?: Partial<Record<DatePatternName, boolean>> } = {};
  if (input.verbs !== undefined) {
    if (!Array.isArray(input.verbs) || input.verbs.length > 100) throw new ValidationError("verbs must be a list of up to 100 words");
    const verbs = input.verbs.map((verb, index) => {
      if (typeof verb !== "string" || !/^[a-z][a-z'-]{0,29}$/.test(verb.trim().toLowerCase())) throw new ValidationError(`verbs[${index}] must be a single word of 1 to 30 letters`);
      return verb.trim().toLowerCase();
    });
    patch.verbs = [...new Set(verbs)];
  }
  if (input.datePatterns !== undefined) {
    if (!isObject(input.datePatterns)) throw new ValidationError("datePatterns must be an object of pattern: true/false");
    const toggles: Partial<Record<DatePatternName, boolean>> = {};
    for (const [name, value] of Object.entries(input.datePatterns)) {
      if (!(datePatternNames as readonly string[]).includes(name)) throw new ValidationError(`Unknown date pattern: ${name}; use one of ${datePatternNames.join(", ")}`);
      if (typeof value !== "boolean") throw new ValidationError(`datePatterns.${name} must be true or false`);
      toggles[name as DatePatternName] = value;
    }
    patch.datePatterns = toggles;
  }
  return patch;
}

export function requirePattern(value: unknown): string {
  if (typeof value !== "string" || !/^(date:(iso|d_mon|mon_d|weekday|today|tomorrow|on_the_nth)|verb:[a-z][a-z'-]{0,29})$/.test(value)) {
    throw new ValidationError("pattern must look like date:weekday or verb:buy");
  }
  return value;
}
