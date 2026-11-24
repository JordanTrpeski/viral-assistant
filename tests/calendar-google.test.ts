import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CALENDAR_READONLY_SCOPE, GoogleCalendarConnection, GoogleClientMissingError, ReconnectRequiredError, parseCalendarList, type GoogleClientConfig, type HttpResponse } from "../src/dashboard/calendar/google.js";

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
  assert.equal(query.get("scope"), CALENDAR_READONLY_SCOPE, "read-only Calendar scope only");
  assert.equal(query.get("state"), "fake-state");
  assert.equal(query.get("code_challenge"), "fake-code-challenge");
  assert.equal(query.get("code_challenge_method"), "S256");
  assert.equal(query.get("access_type"), "offline", "needed for a refresh token");
  assert.equal(query.get("prompt"), "consent");
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
