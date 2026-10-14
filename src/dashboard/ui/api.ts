// JSON client for the loopback dashboard API.

export class ApiError extends Error {}

export async function api<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: body === undefined ? {} : { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed with HTTP ${response.status}`);
  return data as T;
}

/** Shared page context: re-render after a change, and report errors without blocking. */
export interface AppContext {
  refresh(): Promise<void>;
  notify(message: string): void;
  navigate(route: string): void;
  today: string;
}

/** Runs a mutation, reports failures, and re-renders so every view shows the saved state. */
export async function save(context: AppContext, action: () => Promise<unknown>): Promise<void> {
  try { await action(); }
  catch (error) { context.notify((error as Error).message); }
  await context.refresh();
}
