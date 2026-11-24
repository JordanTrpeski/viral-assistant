// Organise Settings (phase 4): the Google connection (moved here from the old Calendar setup page), the
// calendar list with per-calendar show/hide and highlight (display-only, stored locally), and the default time
// zone. No writes to Google.
import { api, save, type AppContext } from "./api.js";
import { h } from "./dom.js";

interface GoogleStatus { clientPresent: boolean; connected: boolean; account: string | null; writeScope: boolean; }
interface SyncResult { line: string; readOnly?: string; reconnect: boolean; lastSync: string | null; }
interface WriteTarget { writeCalendarId: string | null; writable: { id: string; name: string }[]; }
interface Category { id: string; name: string; colour: string | null; }
type Palette = Record<string, { background: string; foreground: string }>;
interface PrefRow { id: string; name: string; readOnly: boolean; highlight: boolean; hidden: boolean; }
interface CalendarSettings { timeZone: string; allDayReminderTime: string; trashDays: number; }

function lastSyncText(iso: string | null): string {
  if (!iso) return "Last sync: never.";
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? "Last sync: never." : `Last sync: ${when.toLocaleString()}.`;
}

export async function renderCalendarSettings(container: HTMLElement, context: AppContext): Promise<void> {
  const status = await api<GoogleStatus>("GET", "/api/calendar/google/status");
  const settings = await api<CalendarSettings>("GET", "/api/calendar/settings");

  const children: HTMLElement[] = [h("h2", {}, "Settings")];

  // --- Google connection -------------------------------------------------
  const connectionPanel = h("div", { class: "panel" }, h("h3", {}, "Google connection"));
  if (!status.clientPresent) {
    connectionPanel.append(
      h("p", {}, "No Google client file found."),
      h("p", { class: "muted small" }, "In Google Cloud Console → APIs & Services → Credentials, create an OAuth 2.0 Client ID of type \"Desktop app\", download its JSON, and save it as .viral/calendar/client_secret.json. Then reload this page."));
  } else {
    const connect = h("button", { class: "primary", onclick: () => save(context, async () => { context.notify("Opening Google sign-in…"); await api("POST", "/api/calendar/google/connect"); }) }, status.connected ? "Reconnect Google" : "Connect Google");
    const actions: HTMLElement[] = [connect];
    if (status.connected) actions.push(h("button", { class: "danger", onclick: () => save(context, () => api("POST", "/api/calendar/google/disconnect")) }, "Disconnect"));
    connectionPanel.append(h("p", {}, status.connected ? `Connected${status.account ? ` as ${status.account}` : ""}.` : "Not connected."), h("div", { class: "actions" }, ...actions));
  }
  children.push(connectionPanel);

  // --- Write access warning ---------------------------------------------
  if (status.connected && !status.writeScope) {
    connectionPanel.append(h("p", { class: "muted small", style: "color: var(--bills)" }, "Read-only access only. Reconnect Google to grant write access before pushing items to your calendar."));
  }

  // --- Sync --------------------------------------------------------------
  if (status.connected) {
    const line = h("p", { class: "muted small" }, lastSyncText(null));
    const syncButton = h("button", { class: "primary", onclick: async () => {
      line.textContent = "Syncing…";
      try {
        const result = await api<SyncResult>("POST", "/api/calendar/google/sync");
        context.notify(result.line);
        line.textContent = result.reconnect ? result.line : `${result.line}${result.readOnly ? ` ${result.readOnly}` : ""} ${lastSyncText(result.lastSync)}`;
        await renderCalendarSettings(container, context);
      } catch (error) { line.textContent = (error as Error).message; }
    } }, "Sync now");
    void api<{ lastSync: string | null }>("GET", "/api/calendar/google/events?days=7").then((events) => { line.textContent = lastSyncText(events.lastSync); }).catch(() => undefined);
    children.push(h("div", { class: "panel" }, h("h3", {}, "Sync"), h("div", { class: "actions" }, syncButton), line));

    // --- Calendar list with show/hide and highlight ----------------------
    const prefs = await api<{ calendars: PrefRow[] }>("GET", "/api/calendar/prefs");
    const prefTable = h("table", { class: "grid-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Calendar"), h("th", {}, "Access"), h("th", {}, "Show"), h("th", {}, "Highlight"))),
      h("tbody", {}, ...(prefs.calendars.length ? prefs.calendars.map((row) => {
        const show = h("input", { type: "checkbox", ...(row.hidden ? {} : { checked: true }) });
        show.addEventListener("change", () => { void api("PATCH", `/api/calendar/prefs/${encodeURIComponent(row.id)}`, { hidden: !(show as HTMLInputElement).checked }); });
        const highlight = h("input", { type: "checkbox", ...(row.highlight ? { checked: true } : {}) });
        highlight.addEventListener("change", () => { void api("PATCH", `/api/calendar/prefs/${encodeURIComponent(row.id)}`, { highlight: (highlight as HTMLInputElement).checked }); });
        return h("tr", {}, h("td", {}, row.name), h("td", { class: "muted" }, row.readOnly ? "read-only" : "writable"), h("td", {}, show), h("td", {}, highlight));
      }) : [h("tr", {}, h("td", {}, "No calendars yet — Sync now."))])));
    children.push(h("div", { class: "panel" }, h("h3", {}, "Calendars"), h("p", { class: "muted small" }, "Show/hide and highlight are stored in the app only; they never change Google or the stored events."), prefTable));

    // --- Write target: which writable calendar receives pushed items -----
    const target = await api<WriteTarget>("GET", "/api/calendar/google/write-target");
    const targetSelect = h("select", {}, h("option", { value: "" }, "— none (don't push) —"), ...target.writable.map((calendar) => h("option", { value: calendar.id }, calendar.name)));
    if (target.writeCalendarId) (targetSelect as HTMLSelectElement).value = target.writeCalendarId;
    targetSelect.addEventListener("change", () => save(context, () => api("PATCH", "/api/calendar/google/write-target", { writeCalendarId: (targetSelect as HTMLSelectElement).value || null })));
    children.push(h("div", { class: "panel" }, h("h3", {}, "Push target"), h("p", { class: "muted small" }, "Timed items are pushed only to this writable calendar. Defaults to \"Viral test\"; never the primary."), h("div", { class: "addbar" }, targetSelect)));

    // --- Category colours from Google's palette --------------------------
    const coloursResult = await api<{ colours?: Palette; reconnect?: boolean }>("GET", "/api/calendar/google/colours");
    const palette = coloursResult.colours ?? {};
    const categories = await api<Category[]>("GET", "/api/calendar/categories");
    const colourRows = categories.map((category) => {
      const select = h("select", {}, h("option", { value: "" }, "Google default"), ...Object.keys(palette).map((id) => h("option", { value: id }, `Colour ${id}`)));
      if (category.colour) (select as HTMLSelectElement).value = category.colour;
      const swatch = h("span", { class: "swatch", style: `background:${category.colour && palette[category.colour] ? palette[category.colour]!.background : "transparent"}` });
      select.addEventListener("change", () => {
        const value = (select as HTMLSelectElement).value || null;
        swatch.setAttribute("style", `background:${value && palette[value] ? palette[value]!.background : "transparent"}`);
        void api("PATCH", `/api/calendar/categories/${encodeURIComponent(category.id)}/colour`, { colour: value });
      });
      return h("tr", {}, h("td", {}, category.name), h("td", {}, swatch), h("td", {}, select));
    });
    children.push(h("div", { class: "panel" }, h("h3", {}, "Category colours"),
      h("p", { class: "muted small" }, Object.keys(palette).length ? "Pushed events use their category's colour. Google owns the colour only if you change it in Google; the next push overwrites it." : "Colours load from Google once connected with write access."),
      h("table", { class: "grid-table" }, h("tbody", {}, ...colourRows))));
  }

  // --- Default time zone -------------------------------------------------
  const zone = h("input", { type: "text", value: settings.timeZone, class: "grow" });
  const saveZone = h("button", { class: "primary", onclick: () => save(context, () => api("PATCH", "/api/calendar/settings", { timeZone: (zone as HTMLInputElement).value.trim() })) }, "Save");
  children.push(h("div", { class: "panel" }, h("h3", {}, "Default time zone"), h("p", { class: "muted small" }, "An IANA zone name, e.g. Europe/Ljubljana. New items default to it; each item keeps its own zone."), h("div", { class: "addbar" }, zone, saveZone)));

  container.replaceChildren(h("div", { class: "page cal-settings" }, ...children));
}
