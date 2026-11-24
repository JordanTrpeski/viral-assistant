import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarService } from "../src/dashboard/calendar/service.js";

/** Local noon on the given date, so the injected clock's local date equals the date regardless of time zone. */
export function localNoon(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 12, 0, 0);
}

export interface CalendarHarness {
  service: CalendarService;
  /** Replace "now" (for trash purge, undo expiry, snooze, today). */
  setNow: (date: Date) => void;
  now: () => Date;
  /** Advance "now" by whole seconds. */
  advanceSeconds: (seconds: number) => void;
}

/** Runs `body` with a fresh CalendarService over a temp store and a mutable injected clock. Fixtures only. */
export async function withCalendar(startIso: string, body: (harness: CalendarHarness) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "viral-calendar-"));
  let current = localNoon(startIso);
  const clock = (): Date => current;
  const harness: CalendarHarness = {
    service: new CalendarService(join(directory, "calendar", "store.json"), { clock }),
    setNow: (date) => { current = date; },
    now: () => current,
    advanceSeconds: (seconds) => { current = new Date(current.getTime() + seconds * 1000); }
  };
  try { await body(harness); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
