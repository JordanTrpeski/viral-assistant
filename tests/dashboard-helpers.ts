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

import { request as httpRequest } from "node:http";
import type { RunningServer } from "../src/dashboard/http.js";
import { createDashboardContext, startDashboardServer, type DashboardContext } from "../src/dashboard/server.js";

export interface TestServer {
  context: DashboardContext;
  server: RunningServer;
  directory: string;
  call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
}

/** Starts the real dashboard server on an ephemeral loopback port against a temp data directory. */
export async function withServer(today: string, body: (test: TestServer) => Promise<void>, budgetStepCents = 1_000): Promise<void> {
  await withTempDir(async (directory) => {
    const context = createDashboardContext({ dataDir: directory, budgetStepCents, clock: clockAt(today) });
    const server = await startDashboardServer(context, "127.0.0.1", 0);
    try {
      await body({
        context, server, directory,
        async call<T>(method: string, path: string, payload?: unknown) {
          const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
            method, ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
          });
          const text = await response.text();
          return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
        }
      });
    } finally {
      await server.stop();
    }
  });
}

/** Raw request with full control over headers (fetch does not allow overriding Host). */
export function rawRequest(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; text: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: options.headers ?? {} }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text, headers: response.headers }));
    });
    request.on("error", reject);
    request.end(options.body);
  });
}
