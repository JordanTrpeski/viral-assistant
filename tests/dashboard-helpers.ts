import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FinanceService } from "../src/dashboard/finance.js";

/** Runs `body` with a fresh temporary directory that is always removed; tests never touch the real .viral/. */
export async function withTempDir<T>(body: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "viral-dashboard-"));
  try { return await body(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

/** A clock fixed at local noon on the given date, so local-date helpers are timezone independent. */
export function clockAt(isoDate: string): () => Date {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return () => new Date(year, month - 1, day, 12, 0, 0);
}

export function openFinance(directory: string, today = "2026-11-15"): FinanceService {
  return FinanceService.open(join(directory, "finance"), { clock: clockAt(today) });
}
