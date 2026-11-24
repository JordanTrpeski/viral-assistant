// Wall-clock (date + time in an IANA zone) to an exact instant with its UTC offset. Needed for Google, which
// takes RFC3339 timestamps with an offset. Uses the platform's IANA database via Intl; no hardcoded DST rules.
import type { IsoDate } from "../shared/dates.js";

/** The zone's offset from UTC, in minutes (east of UTC is positive), for a given absolute instant. */
export function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date(instantMs));
  const field = (type: string): number => Number(parts.find((part) => part.type === type)!.value);
  // The same instant expressed as the zone's wall clock, read back as if it were UTC.
  const asUtc = Date.UTC(field("year"), field("month") - 1, field("day"), field("hour"), field("minute"), field("second"));
  return (asUtc - instantMs) / 60_000;
}

function pad(value: number): string {
  return String(Math.abs(value)).padStart(2, "0");
}

/** Formats an offset in minutes as "+HH:MM" / "-HH:MM" (RFC3339 style). */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  return `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
}

export interface WallClock {
  date: IsoDate;
  /** HH:MM in 24-hour form. */
  time: string;
}

/** The local wall-clock date and HH:MM for an absolute instant, read in the given IANA zone. */
export function instantToWallClock(instantMs: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).formatToParts(new Date(instantMs));
  const get = (type: string): string => parts.find((part) => part.type === type)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export interface ZonedInstant {
  /** The absolute instant as an ISO-8601 UTC string (…Z). */
  instant: string;
  /** Epoch milliseconds of the instant. */
  instantMs: number;
  /** The zone's offset at that instant, in minutes east of UTC. */
  offsetMinutes: number;
  /** The offset as "+HH:MM". */
  offset: string;
  /** The wall clock paired with its offset, e.g. "2027-03-28T03:30:00+02:00" (what Google wants). */
  rfc3339: string;
}

/**
 * Converts a wall-clock date and HH:MM in an IANA zone to the exact instant. Two passes settle daylight-saving
 * boundaries: guess the offset from the wall clock read as UTC, then re-read it at the resulting instant. A
 * nonexistent spring-forward time resolves to the instant the offset implies; an ambiguous autumn time resolves
 * to the first (pre-change) occurrence, which is sufficient for computing reminder instants.
 */
export function zonedToInstant(date: IsoDate, time: string, timeZone: string): ZonedInstant {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offsetMinutes = offsetMinutesAt(wallAsUtc, timeZone);
  let instantMs = wallAsUtc - offsetMinutes * 60_000;
  offsetMinutes = offsetMinutesAt(instantMs, timeZone);
  instantMs = wallAsUtc - offsetMinutes * 60_000;
  const offset = formatOffset(offsetMinutes);
  return {
    instant: new Date(instantMs).toISOString(),
    instantMs,
    offsetMinutes,
    offset,
    rfc3339: `${date}T${time}:00${offset}`
  };
}
