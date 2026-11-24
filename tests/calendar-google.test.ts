import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CALENDAR_EVENTS_SCOPE, CALENDAR_READONLY_SCOPE, CALENDAR_SCOPES, GoogleCalendarConnection, GoogleClientMissingError, ReconnectRequiredError, describeAuthRequest, parseCalendarList, type GoogleClientConfig, type HttpResponse } from "../src/dashboard/calendar/google.js";

const clientJson = JSON.stringify({ installed: { client_id: "cid", client_secret: "secret", auth_uri: "https://accounts.google.com/o/oauth2/auth", token_uri: "https://oauth2.googleapis.com/token" } });
const tokenJson = JSON.stringify({ refreshToken: "rt", account: "a@example.com", scope: "https://www.googleapis.com/auth/calendar.readonly", obtainedAt: "2026-11-01T00:00:00.000Z" });

const enoent = (): never => { throw Object.assign(new Error("not found"), { code: "ENOENT" }); };

// A readFile map keyed by filename, so no test touches a real client/token file.
function files(map: { client?: string; token?: string }): (path: string) => Promise<string> {
  return async (path: string) => {
    if (path.endsWith("client_secret.json")) return map.client ?? enoent();
    if (path.endsWith("google-token.json")) return map.token ?? enoent();
    return enoent();
  };
}

test("google: calendar list parsing maps access roles to writable/read-only, names and primary", () => {
  const calendars = parseCalendarList({ items: [
    { id: "me@example.com", summary: "Me", primary: true, accessRole: "owner" },
    { id: "team@example.com", summary: "Team", accessRole: "writer" },
    { id: "hol@group.calendar.google.com", summaryOverride: "Holidays", summary: "Holidays in X", accessRole: "reader" },
    { id: "busy@example.com", summary: "Busy", accessRole: "freeBusyReader" }
  ] });
  assert.deepEqual(calendars.map((calendar) => [calendar.name, calendar.writable, calendar.primary]), [
    ["Me", true, true],
    ["Team", true, false],
    ["Holidays", false, false],   // summaryOverride wins
    ["Busy", false, false]
  ]);
});

test("google: the sign-in URL carries every parameter Google's installed-app flow requires", () => {
  const config: GoogleClientConfig = {
    clientId: "fake-client-id.apps.googleusercontent.com",
    clientSecret: "fake-secret",
    authUri: "https://accounts.google.com/o/oauth2/auth",
    tokenUri: "https://oauth2.googleapis.com/token"
  };
  const connection = new GoogleCalendarConnection("/fake/calendar", { readFile: files({}) });
  const redirectUri = "http://127.0.0.1:54321";
  const url = new URL(connection.buildAuthUrl(config, redirectUri, "fake-code-challenge", "fake-state"));

  assert.equal(`${url.origin}${url.pathname}`, config.authUri, "points at the client's auth endpoint");
  const query = url.searchParams;
  assert.equal(query.get("response_type"), "code", "response_type=code is present");
  assert.equal(query.get("client_id"), config.clientId);
  assert.equal(query.get("redirect_uri"), redirectUri, "the 127.0.0.1 loopback redirect");
  assert.equal(query.get("scope"), CALENDAR_SCOPES, "read-only + events scopes");
  assert.ok(query.get("scope")!.includes(CALENDAR_READONLY_SCOPE) && query.get("scope")!.includes(CALENDAR_EVENTS_SCOPE), "both calendar scopes are requested");
  assert.equal(query.get("state"), "fake-state");
  assert.equal(query.get("code_challenge"), "fake-code-challenge");
  assert.equal(query.get("code_challenge_method"), "S256");
  assert.equal(query.get("access_type"), "offline", "needed for a refresh token");
  assert.equal(query.get("prompt"), "consent");
});

test("google: the sign-in diagnostic log shows response_type=code and never the client secret", () => {
  const secret = "fake-client-secret-never-log-me";
  const config: GoogleClientConfig = {
    clientId: "fake-client-id.apps.googleusercontent.com",
    clientSecret: secret,
    authUri: "https://accounts.google.com/o/oauth2/auth",
    tokenUri: "https://oauth2.googleapis.com/token"
  };
  const connection = new GoogleCalendarConnection("/fake/calendar", { readFile: files({}) });
  const url = connection.buildAuthUrl(config, "http://127.0.0.1:54321", "challenge-abcdefghijklmnop", "state-xyz9876543");
  const log = describeAuthRequest(url);

  assert.match(log, /response_type=code/, "the diagnostic names response_type=code");
  assert.ok(!log.includes(secret), "the client secret never appears in the diagnostic");
  assert.match(log, /endpoint: https:\/\/accounts\.google\.com\/o\/oauth2\/auth/);
  assert.match(log, /state=state-xy… \(truncated\)/, "state is truncated to 8 characters");
  assert.match(log, /code_challenge=challeng… \(truncated\)/, "code_challenge is truncated to 8 characters");
});

test("google: the browser opener receives the full sign-in URL with every query parameter intact", () => {
  const config: GoogleClientConfig = {
    clientId: "fake-client-id.apps.googleusercontent.com",
    clientSecret: "fake-secret",
    authUri: "https://accounts.google.com/o/oauth2/auth",
    tokenUri: "https://oauth2.googleapis.com/token"
  };
  let opened = "";
  const logs: string[] = [];
  const connection = new GoogleCalendarConnection("/fake/calendar", {
    readFile: files({}),
    openBrowser: async (url) => { opened = url; },
    log: (line) => logs.push(line)
  });
  const redirectUri = "http://127.0.0.1:54321";
  const returned = connection.launchSignIn(config, redirectUri, "fake-code-challenge", "fake-state-value");

  // The opener must get exactly the URL that was built — not a prefix truncated at the first "&".
  assert.equal(opened, returned, "the opener receives the full URL");
  const params = new URL(opened).searchParams;
  assert.equal(params.get("response_type"), "code", "response_type=code survived");
  assert.equal(params.get("client_id"), config.clientId);
  assert.equal(params.get("redirect_uri"), redirectUri);
  assert.equal(params.get("scope"), CALENDAR_SCOPES);
  assert.equal(params.get("access_type"), "offline");
  assert.equal(params.get("prompt"), "consent");
  assert.equal(params.get("code_challenge"), "fake-code-challenge");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("state"), "fake-state-value");
  assert.equal(params.size, 9, "all nine &-joined parameters are present");
  assert.ok(logs.some((line) => line.includes("9 query params")), "logs the parameter count before opening");
});

test("google: event colours come from the palette endpoint and are not hardcoded", async () => {
  const http = async (request: { url: string }): Promise<HttpResponse> => {
    if (request.url.includes("oauth2.googleapis.com/token")) return { status: 200, json: { access_token: "at", expires_in: 3599 } };
    if (request.url.includes("/colors")) return { status: 200, json: { event: { "5": { background: "#fbd75b", foreground: "#1d1d1d" }, "11": { background: "#dc2127", foreground: "#1d1d1d" } }, calendar: {} } };
    throw new Error(`unexpected call to ${request.url}`);
  };
  const connection = new GoogleCalendarConnection("/fake/calendar", { readFile: files({ client: clientJson, token: tokenJson }), http });
  const palette = await connection.eventColours();
  assert.deepEqual(Object.keys(palette).sort(), ["11", "5"]);
  assert.equal(palette["5"]!.background, "#fbd75b");
});

test("google: hasWriteScope is false for an old read-only token and true once events scope is granted", async () => {
  const readOnly = new GoogleCalendarConnection("/fake/calendar", { readFile: files({ client: clientJson, token: tokenJson }) });
  assert.equal(await readOnly.hasWriteScope(), false, "the phase-2 token has no write scope");
  assert.equal((await readOnly.status()).writeScope, false);

  const writeTokenJson = JSON.stringify({ refreshToken: "rt", account: "a@example.com", scope: `${CALENDAR_READONLY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`, obtainedAt: "2026-11-01T00:00:00.000Z" });
  const writable = new GoogleCalendarConnection("/fake/calendar", { readFile: files({ client: clientJson, token: writeTokenJson }) });
  assert.equal(await writable.hasWriteScope(), true, "reconnecting with the events scope enables writes");
});

test("google: a missing client file gives a clear message that says where to put it", async () => {
  const connection = new GoogleCalendarConnection("/fake/calendar", { readFile: files({}) });
  await assert.rejects(connection.loadClientConfig(), (error: unknown) => {
    assert.ok(error instanceof GoogleClientMissingError);
    assert.match((error as Error).message, /client_secret\.json/);
    assert.match((error as Error).message, /Desktop app/);
    return true;
  });
  const status = await connection.status();
  assert.deepEqual([status.clientPresent, status.connected], [false, false]);
});

test("google: a failing refresh leads to Reconnect Google and does not retry in a loop", async () => {
  let tokenCalls = 0;
  const http = async (request: { url: string }): Promise<HttpResponse> => {
    if (request.url.includes("oauth2.googleapis.com/token")) { tokenCalls += 1; return { status: 400, json: { error: "invalid_grant" } }; }
    throw new Error(`unexpected call to ${request.url}`);
  };
  const connection = new GoogleCalendarConnection("/fake/calendar", { readFile: files({ client: clientJson, token: tokenJson }), http });
  await assert.rejects(connection.accessToken(), (error: unknown) => {
    assert.ok(error instanceof ReconnectRequiredError);
    assert.match((error as Error).message, /Reconnect Google/);
    return true;
  });
  assert.equal(tokenCalls, 1, "the refresh is attempted once, with no retry loop");
});

test("google: listCalendars refreshes then reads the list, mapping roles (Google mocked)", async () => {
  const http = async (request: { url: string }): Promise<HttpResponse> => {
    if (request.url.includes("oauth2.googleapis.com/token")) return { status: 200, json: { access_token: "at", expires_in: 3599 } };
    if (request.url.includes("calendarList")) return { status: 200, json: { items: [
      { id: "me@example.com", summary: "Me", primary: true, accessRole: "owner" },
      { id: "sub@group.calendar.google.com", summary: "Subscribed", accessRole: "reader" }
    ] } };
    throw new Error(`unexpected call to ${request.url}`);
  };
  const connection = new GoogleCalendarConnection("/fake/calendar", { readFile: files({ client: clientJson, token: tokenJson }), http });
  const calendars = await connection.listCalendars();
  assert.deepEqual(calendars.map((calendar) => [calendar.name, calendar.writable]), [["Me", true], ["Subscribed", false]]);
});

test("google: disconnect deletes the stored token file (and does not throw if it is already gone)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viral-google-"));
  try {
    const tokenPath = join(directory, "google-token.json");
    await writeFile(tokenPath, tokenJson, "utf8");
    let revokeCalled = false;
    const http = async (request: { url: string }): Promise<HttpResponse> => {
      if (request.url.includes("/revoke")) { revokeCalled = true; return { status: 200, json: {} }; }
      throw new Error(`unexpected call to ${request.url}`);
    };
    const connection = new GoogleCalendarConnection(directory, { http });
    await connection.disconnect();
    await assert.rejects(readFile(tokenPath, "utf8"), /ENOENT/, "the token file is deleted");
    assert.equal(revokeCalled, true, "disconnect best-effort revokes at Google");
    await connection.disconnect(); // a second disconnect is a no-op, not an error
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
