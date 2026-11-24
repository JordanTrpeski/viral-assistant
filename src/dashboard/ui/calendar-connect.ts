// Temporary Google connection page (#/calendar-connect). Phases 2–3 only; phase 4 replaces it with the real
// calendar screens. Shows connection status, Connect / Disconnect, a Sync now button with its result line and
// last-sync time, the calendar list with access roles, and a read-only list of the next 7 days of events.
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

interface SyncResult {
  line: string;
  reconnect: boolean;
  lastSync: string | null;
}

interface UpcomingEvent {
  title: string;
  calendarName: string;
  date: string;
  time: string | null;
  allDay: boolean;
}

interface EventsResult {
  lastSync: string | null;
  days: number;
  events: UpcomingEvent[];
}

function formatLastSync(iso: string | null): string {
  if (!iso) return "Last sync: never.";
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? "Last sync: never." : `Last sync: ${when.toLocaleString()}.`;
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
    h("p", { class: "muted small" }, "Temporary setup page (phases 2–3). Read-only — nothing is written to Google yet.")
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

  const calendarsPanel = h("div", { class: "panel" }, h("h3", {}, "Calendars"), h("p", { class: "muted small" }, "Loading…"));
  const syncResultLine = h("p", { class: "muted small" }, formatLastSync(null));
  const eventsPanel = h("div", { class: "panel" }, h("h3", {}, "Next 7 days"), h("p", { class: "muted small" }, "Loading…"));

  const loadEvents = async (): Promise<void> => {
    try {
      const result = await api<EventsResult>("GET", "/api/calendar/google/events?days=7");
      syncResultLine.textContent = formatLastSync(result.lastSync);
      if (!result.events.length) {
        eventsPanel.replaceChildren(h("h3", {}, "Next 7 days"), h("p", { class: "muted small" }, "No events in the next 7 days."));
        return;
      }
      eventsPanel.replaceChildren(
        h("h3", {}, "Next 7 days"),
        h("table", { class: "grid-table" },
          h("thead", {}, h("tr", {}, h("th", {}, "When"), h("th", {}, "Title"), h("th", {}, "Calendar"))),
          h("tbody", {}, ...result.events.map((event) => h("tr", {},
            h("td", {}, event.allDay ? `${event.date} (all day)` : `${event.date} ${event.time ?? ""}`.trim()),
            h("td", {}, event.title),
            h("td", { class: "muted" }, event.calendarName))))));
    } catch (error) {
      eventsPanel.replaceChildren(h("h3", {}, "Next 7 days"), h("p", { class: "muted small" }, (error as Error).message));
    }
  };

  const syncButton = h("button", {
    class: "primary",
    onclick: async () => {
      syncResultLine.textContent = "Syncing…";
      try {
        const result = await api<SyncResult>("POST", "/api/calendar/google/sync");
        context.notify(result.line);
        await loadEvents();
        if (!result.reconnect) syncResultLine.textContent = `${result.line} ${formatLastSync(result.lastSync)}`;
        else syncResultLine.textContent = result.line;
      } catch (error) { syncResultLine.textContent = (error as Error).message; }
    }
  }, "Sync now");

  if (status.connected) {
    children.push(h("div", { class: "panel" }, h("h3", {}, "Sync"), h("div", { class: "actions" }, syncButton), syncResultLine));
  }
  children.push(calendarsPanel);
  if (status.connected) children.push(eventsPanel);
  container.replaceChildren(h("div", { class: "page calendar-connect" }, ...children));

  if (!status.connected || !status.clientPresent) {
    calendarsPanel.replaceChildren(h("h3", {}, "Calendars"), h("p", { class: "muted small" }, "Connect Google to see your calendars."));
    return;
  }

  void loadEvents();

  const result = await api<CalendarsResult>("GET", "/api/calendar/google/calendars");
  if (result.reconnect) {
    calendarsPanel.replaceChildren(h("h3", {}, "Calendars"), h("p", {}, result.error ?? "Reconnect Google."));
    return;
  }
  if (!result.calendars.length) {
    calendarsPanel.replaceChildren(h("h3", {}, "Calendars"), h("p", { class: "muted small" }, "No calendars found."));
    return;
  }
  calendarsPanel.replaceChildren(
    h("h3", {}, "Calendars"),
    h("table", { class: "grid-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Access"), h("th", {}, "Writable"), h("th", {}, "Primary"))),
      h("tbody", {}, ...result.calendars.map((calendar) => h("tr", {},
        h("td", {}, calendar.name),
        h("td", {}, calendar.accessRole),
        h("td", {}, calendar.writable ? "writable" : "read-only"),
        h("td", {}, calendar.primary ? "✓" : ""))))));
}
