import { ValidationError } from "./errors.js";
import { isIsoDate, isIsoMonth, type IsoDate, type IsoMonth } from "./shared/dates.js";
import { isCents, isPositiveCents } from "./shared/money.js";

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireObject(value: unknown, label = "body"): JsonObject {
  if (!isObject(value)) throw new ValidationError(`${label} must be a JSON object`);
  return value;
}

export function requireText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || value.trim() === "") throw new ValidationError(`${field} must be a non-empty string`);
  if (value.length > maxLength) throw new ValidationError(`${field} must be at most ${maxLength} characters`);
  return value.trim();
}

export function optionalText(value: unknown, field: string, maxLength = 500): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  if (value.length > maxLength) throw new ValidationError(`${field} must be at most ${maxLength} characters`);
  return value.trim();
}

export function requireDate(value: unknown, field = "date"): IsoDate {
  if (!isIsoDate(value)) throw new ValidationError(`${field} must be a valid date in YYYY-MM-DD format`);
  return value;
}

export function requireMonth(value: unknown, field = "month"): IsoMonth {
  if (!isIsoMonth(value)) throw new ValidationError(`${field} must be a month in YYYY-MM format`);
  return value;
}

export function requirePositiveCents(value: unknown, field = "amountCents"): number {
  if (!isPositiveCents(value)) throw new ValidationError(`${field} must be a positive whole number of cents (zero and negative amounts are rejected)`);
  return value;
}

export function requireNonNegativeCents(value: unknown, field: string): number {
  if (!isCents(value) || value < 0) throw new ValidationError(`${field} must be a whole number of cents, zero or more`);
  return value;
}

export function requireCents(value: unknown, field: string): number {
  if (!isCents(value)) throw new ValidationError(`${field} must be a whole number of cents`);
  return value;
}

export function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new ValidationError(`${field} must be a whole number of at least 1`);
  return value;
}

export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`);
  return value;
}

/** Rejects fields that are not part of a payload so typos do not silently do nothing. */
export function rejectUnknownFields(body: JsonObject, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ValidationError(`Unknown field(s): ${unknown.join(", ")}`);
}
