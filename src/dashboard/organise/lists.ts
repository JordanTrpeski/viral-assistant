// Lists: a name and an ordered set of statuses (the last one counts as done). A preset is only a set of status names.
import { ValidationError } from "../errors.js";
import { rejectUnknownFields, requireObject, type JsonObject } from "../validation.js";

export const listPresets: Readonly<Record<string, readonly string[]>> = {
  default: ["to do", "doing", "done"],
  books: ["to read", "reading", "finished"],
  films: ["to watch", "watching", "watched"]
};

export const maxListNameLength = 100;
export const maxStatusLength = 40;
export const maxStatuses = 10;

export function listName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > maxListNameLength) throw new ValidationError(`name must be 1 to ${maxListNameLength} characters`);
  return value.trim();
}

export function listStatuses(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxStatuses) throw new ValidationError(`statuses must be a list of 1 to ${maxStatuses} names`);
  const statuses = value.map((status, index) => {
    if (typeof status !== "string" || status.trim().length < 1 || status.trim().length > maxStatusLength) throw new ValidationError(`statuses[${index}] must be 1 to ${maxStatusLength} characters`);
    return status.trim();
  });
  if (new Set(statuses.map((status) => status.toLowerCase())).size !== statuses.length) throw new ValidationError("statuses must be different from each other");
  return statuses;
}

/** A new list: `name` plus either `statuses` or a `preset` name; without either it gets the default statuses. */
export function newListFields(body: unknown): { name: string; statuses: string[] } {
  const input: JsonObject = requireObject(body);
  rejectUnknownFields(input, ["name", "statuses", "preset"]);
  if (input.statuses !== undefined && input.preset !== undefined) throw new ValidationError("Send statuses or preset, not both");
  let statuses: string[];
  if (input.preset !== undefined) {
    const preset = typeof input.preset === "string" ? listPresets[input.preset] : undefined;
    if (!preset) throw new ValidationError(`preset must be one of: ${Object.keys(listPresets).join(", ")}`);
    statuses = [...preset];
  } else {
    statuses = input.statuses === undefined ? [...listPresets.default!] : listStatuses(input.statuses);
  }
  return { name: listName(input.name), statuses };
}
