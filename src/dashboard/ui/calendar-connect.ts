// Temporary Google connection page (#/calendar-connect). Phase 2 only; phase 4 replaces it with the real
// calendar screens. Shows connection status, Connect / Disconnect, and the calendar list with access roles.
import { api, type AppContext } from "./api.js";
import { h } from "./dom.js";

interface GoogleStatus {
  clientPresent: boolean;
  connected: boolean;
  account: string | null;
}

interface CalendarRow {
  id: string;
  name: string;
  accessRole: string;
  primary: boolean;
  writable: boolean;
}

interface CalendarsResult {
  calendars: CalendarRow[];
  reconnect?: boolean;
  clientPresent?: boolean;
  error?: string;
}

export async function renderCalendarConnect(container: HTMLElement, context: AppContext): Promise<void> {
  const status = await api<GoogleStatus>("GET", "/api/calendar/google/status");

  const connect = h("button", {
    class: "primary",
    onclick: async () => {
      context.notify("Opening Google sign-in in your browser…");
      try { await api("POST", "/api/calendar/google/connect"); context.notify("Connected to Google."); }
      catch (error) { context.notify((error as Error).message); }
      await context.refresh();
    }
  }, status.connected ? "Reconnect Google" : "Connect Google");

  const disconnect = h("button", {
    class: "danger",
    onclick: async () => {
      try { await api("POST", "/api/calendar/google/disconnect"); context.notify("Disconnected from Google."); }
      catch (error) { context.notify((error as Error).message); }
      await context.refresh();
    }
  }, "Disconnect");

  const children: HTMLElement[] = [
    h("h2", {}, "Google Calendar connection"),
    h("p", { class: "muted small" }, "Temporary setup page (phase 2). Read-only access only — nothing is written to Google yet.")
  ];

  if (!status.clientPresent) {
    children.push(h("div", { class: "panel" },
      h("p", {}, "No Google client file found."),
      h("p", { class: "muted small" }, "In Google Cloud Console → APIs & Services → Credentials, create an OAuth 2.0 Client ID of type \"Desktop app\", download its JSON, and save it as .viral/calendar/client_secret.json. Then reload this page.")));
  } else {
    children.push(h("div", { class: "panel" },
      h("p", {}, status.connected ? `Connected${status.account ? ` as ${status.account}` : ""}.` : "Not connected."),
      h("div", { class: "actions" }, connect, status.connected ? disconnect : h("span", {}))));
  }

  const list = h("div", { class: "panel" }, h("h3", {}, "Calendars"), h("p", { class: "muted small" }, "Loading…"));
  children.push(list);
  container.replaceChildren(h("div", { class: "page calendar-connect" }, ...children));

  if (!status.connected || !status.clientPresent) {
    list.replaceChildren(h("h3", {}, "Calendars"), h("p", { class: "muted small" }, "Connect Google to see your calendars."));
    return;
  }

  const result = await api<CalendarsResult>("GET", "/api/calendar/google/calendars");
  if (result.reconnect) {
    list.replaceChildren(h("h3", {}, "Calendars"), h("p", {}, result.error ?? "Reconnect Google."));
    return;
  }
  if (!result.calendars.length) {
    list.replaceChildren(h("h3", {}, "Calendars"), h("p", { class: "muted small" }, "No calendars found."));
    return;
  }
  list.replaceChildren(
    h("h3", {}, "Calendars"),
    h("table", { class: "grid-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Access"), h("th", {}, "Writable"), h("th", {}, "Primary"))),
      h("tbody", {}, ...result.calendars.map((calendar) => h("tr", {},
        h("td", {}, calendar.name),
        h("td", {}, calendar.accessRole),
        h("td", {}, calendar.writable ? "writable" : "read-only"),
        h("td", {}, calendar.primary ? "✓" : ""))))));
}
