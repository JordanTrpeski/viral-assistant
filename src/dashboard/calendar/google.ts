// Google Calendar connection (phase 2): read-only sign-in, one stored refresh token, and the calendar list.
// Read-only scope only (calendar.readonly); write access arrives in phase 5. Network and browser are injected
// so tests never touch the real Google API. Tokens are never logged.
//
// Google rules checked 2026-11 (developers.google.com/identity/protocols/oauth2 and .../oauth2/native-app):
// - A client in "Testing" publishing status gets a refresh token that expires after 7 days (unless only
//   identity scopes are requested — not our case).
// - Limit of 100 refresh tokens per Google Account per OAuth client ID; a new one past the limit silently
//   invalidates the oldest. A refresh token also dies after 6 months unused, or on revoke/password change.
// - Loopback redirect (http://127.0.0.1:PORT) is supported for Desktop-app clients; PKCE is recommended.
// - Read-only Calendar scope: https://www.googleapis.com/auth/calendar.readonly
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic, type StoreFileSystem } from "../store.js";

export const CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const REVOKE_URI = "https://oauth2.googleapis.com/revoke";
const CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";

export class GoogleClientMissingError extends Error {
  constructor(readonly path: string) {
    super(`Google client file not found at ${path}. In Google Cloud Console → APIs & Services → Credentials, create an OAuth 2.0 Client ID of type "Desktop app", download its JSON, and save it as ${path}.`);
    this.name = "GoogleClientMissingError";
  }
}

/** Thrown when the stored sign-in cannot be used; the UI shows "Reconnect Google" and stops (no retry loop). */
export class ReconnectRequiredError extends Error {
  constructor(message = "Reconnect Google") {
    super(message);
    this.name = "ReconnectRequiredError";
  }
}

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
  authUri: string;
  tokenUri: string;
}

export interface StoredToken {
  refreshToken: string;
  account: string | null;
  scope: string;
  obtainedAt: string;
}

export interface GoogleCalendar {
  id: string;
  name: string;
  accessRole: string;
  primary: boolean;
  /** True when the role allows writing (owner or writer); kept for phase 5. Nothing writes in phase 2. */
  writable: boolean;
}

export interface GoogleStatus {
  clientPresent: boolean;
  connected: boolean;
  account: string | null;
}

export interface HttpResponse {
  status: number;
  json: unknown;
}

export type HttpClient = (request: { url: string; method: "GET" | "POST"; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;

export interface GoogleOptions {
  fs?: StoreFileSystem;
  http?: HttpClient;
  openBrowser?: (url: string) => Promise<void>;
  now?: () => Date;
  /** Override only in tests. */
  readFile?: (path: string) => Promise<string>;
}

const WRITABLE_ROLES = new Set(["owner", "writer"]);

/** Parses a Google calendarList response into our shape. Pure, so tests can check role mapping directly. */
export function parseCalendarList(json: unknown): GoogleCalendar[] {
  const items = isObject(json) && Array.isArray(json.items) ? json.items : [];
  return items.filter(isObject).map((item) => {
    const id = String(item.id ?? "");
    const accessRole = typeof item.accessRole === "string" ? item.accessRole : "reader";
    const name = typeof item.summaryOverride === "string" && item.summaryOverride.trim() !== ""
      ? item.summaryOverride
      : typeof item.summary === "string" && item.summary.trim() !== "" ? item.summary : id;
    return { id, name, accessRole, primary: item.primary === true, writable: WRITABLE_ROLES.has(accessRole) };
  }).filter((calendar) => calendar.id !== "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const defaultHttp: HttpClient = async ({ url, method, headers, body }) => {
  const init: RequestInit = { method };
  if (headers) init.headers = headers;
  if (body !== undefined) init.body = body;
  const response = await fetch(url, init);
  const text = await response.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, json };
};

async function openInBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

export class GoogleCalendarConnection {
  private readonly clientPath: string;
  private readonly tokenPath: string;
  private readonly fs: StoreFileSystem;
  private readonly http: HttpClient;
  private readonly openBrowser: (url: string) => Promise<void>;
  private readonly now: () => Date;
  private readonly readFile: (path: string) => Promise<string>;

  constructor(directory: string, options: GoogleOptions = {}) {
    this.clientPath = join(directory, "client_secret.json");
    this.tokenPath = join(directory, "google-token.json");
    this.fs = options.fs ?? nodeFs;
    this.http = options.http ?? defaultHttp;
    this.openBrowser = options.openBrowser ?? openInBrowser;
    this.now = options.now ?? (() => new Date());
    this.readFile = options.readFile ?? ((path) => nodeFs.readFile(path, "utf8"));
  }

  /** Reads and parses the OAuth desktop client JSON. Missing file throws GoogleClientMissingError with guidance. */
  async loadClientConfig(): Promise<GoogleClientConfig> {
    let text: string;
    try { text = await this.readFile(this.clientPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new GoogleClientMissingError(this.clientPath);
      throw error;
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const block = (isObject(parsed.installed) ? parsed.installed : isObject(parsed.web) ? parsed.web : null) as Record<string, unknown> | null;
    if (!block || typeof block.client_id !== "string" || typeof block.client_secret !== "string") {
      throw new Error(`${this.clientPath} is not a valid OAuth desktop client file (expected an "installed" block with client_id and client_secret).`);
    }
    return {
      clientId: block.client_id,
      clientSecret: block.client_secret,
      authUri: typeof block.auth_uri === "string" ? block.auth_uri : "https://accounts.google.com/o/oauth2/auth",
      tokenUri: typeof block.token_uri === "string" ? block.token_uri : "https://oauth2.googleapis.com/token"
    };
  }

  private async loadToken(): Promise<StoredToken | null> {
    let text: string;
    try { text = await this.readFile(this.tokenPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.refreshToken !== "string") return null;
    return {
      refreshToken: parsed.refreshToken,
      account: typeof parsed.account === "string" ? parsed.account : null,
      scope: typeof parsed.scope === "string" ? parsed.scope : CALENDAR_READONLY_SCOPE,
      obtainedAt: typeof parsed.obtainedAt === "string" ? parsed.obtainedAt : this.now().toISOString()
    };
  }

  private async clientPresent(): Promise<boolean> {
    try { await this.readFile(this.clientPath); return true; }
    catch { return false; }
  }

  async status(): Promise<GoogleStatus> {
    const token = await this.loadToken();
    return { clientPresent: await this.clientPresent(), connected: token !== null, account: token?.account ?? null };
  }

  /** Deletes the stored refresh token. Best-effort revoke at Google, but the file is always removed. */
  async disconnect(): Promise<void> {
    const token = await this.loadToken();
    if (token) {
      await this.http({ url: `${REVOKE_URI}?token=${encodeURIComponent(token.refreshToken)}`, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }).catch(() => undefined);
    }
    await this.fs.unlink(this.tokenPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }

  /**
   * Exchanges the stored refresh token for a short-lived access token. One attempt, no retry loop: any failure
   * throws ReconnectRequiredError so the UI can show "Reconnect Google". The access token is never stored or logged.
   */
  async accessToken(): Promise<string> {
    const token = await this.loadToken();
    if (!token) throw new ReconnectRequiredError("Reconnect Google: not signed in yet.");
    const config = await this.loadClientConfig();
    const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: token.refreshToken, grant_type: "refresh_token" }).toString();
    const response = await this.http({ url: config.tokenUri, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (response.status < 200 || response.status >= 300) throw new ReconnectRequiredError("Reconnect Google: the saved sign-in is no longer valid.");
    const json = response.json as { access_token?: unknown };
    if (!isObject(response.json) || typeof json.access_token !== "string") throw new ReconnectRequiredError("Reconnect Google: unexpected token response.");
    return json.access_token;
  }

  /** The user's calendars with their access roles and a writable flag (kept for phase 5). Nothing writes here. */
  async listCalendars(): Promise<GoogleCalendar[]> {
    const access = await this.accessToken();
    const response = await this.http({ url: CALENDAR_LIST_URL, method: "GET", headers: { authorization: `Bearer ${access}` } });
    if (response.status === 401 || response.status === 403) throw new ReconnectRequiredError("Reconnect Google: access was refused.");
    if (response.status < 200 || response.status >= 300) throw new Error(`Google calendar list failed: HTTP ${response.status}`);
    return parseCalendarList(response.json);
  }

  /** Builds the consent URL for the installed-app flow with PKCE and read-only Calendar scope. */
  buildAuthUrl(config: GoogleClientConfig, redirectUri: string, codeChallenge: string, state: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId, redirect_uri: redirectUri, response_type: "code",
      scope: CALENDAR_READONLY_SCOPE, access_type: "offline", prompt: "consent",
      code_challenge: codeChallenge, code_challenge_method: "S256", state
    });
    return `${config.authUri}?${params.toString()}`;
  }

  /**
   * Interactive sign-in: opens the browser, catches the code on a 127.0.0.1 loopback port, exchanges it, and
   * stores the single refresh token. Not run in tests (needs a real browser and Google). Returns the account.
   */
  async connect(timeoutMs = 300_000): Promise<GoogleStatus> {
    const config = await this.loadClientConfig();
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(16).toString("base64url");

    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<html><body>Signed in to Viral. You can close this window.</body></html>");
        const error = url.searchParams.get("error");
        if (error) { server.close(); reject(new Error(`Google sign-in was refused: ${error}`)); return; }
        const received = url.searchParams.get("code");
        if (received && url.searchParams.get("state") === state) {
          const port = (server.address() as { port: number }).port;
          server.close();
          resolve({ code: received, redirectUri: `http://127.0.0.1:${port}` });
        }
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as { port: number }).port;
        void this.openBrowser(this.buildAuthUrl(config, `http://127.0.0.1:${port}`, challenge, state));
      });
      setTimeout(() => { server.close(); reject(new Error("Google sign-in timed out.")); }, timeoutMs);
    });

    const body = new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier,
      grant_type: "authorization_code", redirect_uri: redirectUri
    }).toString();
    const response = await this.http({ url: config.tokenUri, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (response.status < 200 || response.status >= 300 || !isObject(response.json)) throw new Error("Google rejected the sign-in code exchange.");
    const json = response.json as { refresh_token?: unknown; access_token?: unknown; scope?: unknown };
    if (typeof json.refresh_token !== "string") throw new Error("Google did not return a refresh token; sign in again and grant offline access.");
    const account = await this.accountFrom(typeof json.access_token === "string" ? json.access_token : null);
    const token: StoredToken = {
      refreshToken: json.refresh_token,
      account,
      scope: typeof json.scope === "string" ? json.scope : CALENDAR_READONLY_SCOPE,
      obtainedAt: this.now().toISOString()
    };
    await writeJsonAtomic(this.tokenPath, token, this.fs); // one token only; overwrites any previous
    return { clientPresent: true, connected: true, account };
  }

  /** Best-effort account label (email) for display, from the userinfo endpoint; null if it cannot be read. */
  private async accountFrom(accessToken: string | null): Promise<string | null> {
    if (!accessToken) return null;
    try {
      const response = await this.http({ url: "https://openidconnect.googleapis.com/v1/userinfo", method: "GET", headers: { authorization: `Bearer ${accessToken}` } });
      if (isObject(response.json) && typeof response.json.email === "string") return response.json.email;
    } catch { /* display only */ }
    return null;
  }
}
