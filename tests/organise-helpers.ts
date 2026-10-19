import { join } from "node:path";
import { OrganiseService, type OrganiseServiceOptions } from "../src/dashboard/organise/service.js";
import { clockAt } from "./dashboard-helpers.js";

/** A clock that tests can move: starts at local noon on `isoDate`. */
export function movableClock(isoDate: string): { clock: () => Date; advanceDays(days: number): void; advanceMs(ms: number): void } {
  let now = clockAt(isoDate)().getTime();
  return {
    clock: () => new Date(now),
    advanceDays: (days) => { now += days * 86_400_000; },
    advanceMs: (ms) => { now += ms; }
  };
}

export function openOrganise(directory: string, today = "2026-10-14", options: OrganiseServiceOptions = {}): OrganiseService {
  return new OrganiseService(join(directory, "organise"), { clock: clockAt(today), ...options });
}
