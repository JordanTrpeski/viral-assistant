// Routes for the rebuilt Organise (phase 4): items, day/week/month views, the Today strip, search, export,
// settings and per-calendar display prefs. Backed by the phase-1 CalendarService and the phase-3 events store.
// Nothing here writes to Google. Kept separate from server.ts so the screens stay decoupled from the wiring.
import { RawResponse, type Router } from "../http.js";
import { ValidationError } from "../errors.js";
import { ReconnectRequiredError } from "./google.js";
import { localIsoDate, monthOf, type IsoMonth } from "../shared/dates.js";
import { requireDate, requireMonth, isObject } from "../validation.js";
import type { DashboardContext } from "../server.js";
import { defaultCategoryNames } from "./model.js";
import { dayView, itemsToCsv, monthView, overview as calendarOverview, searchItems, todayStrip, weekView } from "./views.js";

function today(context: DashboardContext): string {
  return localIsoDate(context.clock());
}

function monthParam(context: DashboardContext, query: URLSearchParams): IsoMonth {
  const value = query.get("month");
  return value === null ? monthOf(today(context)) : requireMonth(value);
}

export function registerCalendarAppRoutes(router: Router, context: DashboardContext): void {
  const calendar = context.calendar;

  router.add("GET", "/api/calendar/categories", async () => {
    let categories = await calendar.listCategories();
    if (categories.length === 0) {
      for (const name of defaultCategoryNames) await calendar.createCategory({ name });
      categories = await calendar.listCategories();
    }
    return categories.map((category) => ({ id: category.id, name: category.name, colour: category.colour }));
  });

  // Per-category Google event colour (phase 5). The colour id must be a key from /api/calendar/google/colours.
  router.add("PATCH", "/api/calendar/categories/:id/colour", ({ params, body }) => {
    const colour = isObject(body) && (typeof body.colour === "string" || body.colour === null) ? body.colour : null;
    return calendar.setCategoryColour(params.id!, colour);
  });

  // The write target: a writable calendar that receives pushed items. The list shows only writable calendars.
  router.add("GET", "/api/calendar/google/write-target", async () => {
    const document = await context.calendarEvents.read();
    const writable = document.calendars.filter((entry) => !entry.readOnly).map((entry) => ({ id: entry.id, name: entry.name }));
    return { writeCalendarId: document.writeCalendarId, writable };
  });
  router.add("PATCH", "/api/calendar/google/write-target", async ({ body }) => {
    const chosen = isObject(body) && (typeof body.writeCalendarId === "string" || body.writeCalendarId === null) ? body.writeCalendarId : undefined;
    if (chosen === undefined) throw new ValidationError("writeCalendarId must be a calendar id or null");
    return context.calendarEvents.update((draft) => {
      if (chosen !== null) {
        const target = draft.calendars.find((entry) => entry.id === chosen);
        if (!target) throw new ValidationError("unknown calendar");
        if (target.readOnly) throw new ValidationError("that calendar is read-only; writes are only allowed to an owner/writer calendar");
      }
      draft.writeCalendarId = chosen;
      return { writeCalendarId: draft.writeCalendarId };
    });
  });

  // The Google event colour palette, read at runtime (never hardcoded). Any failure returns an empty palette so
  // the Settings page still renders; the user reconnects or syncs to populate it.
  router.add("GET", "/api/calendar/google/colours", async () => {
    try { return { colours: await context.googleCalendar.eventColours() }; }
    catch (error) { return { reconnect: error instanceof ReconnectRequiredError, colours: {} }; }
  });

  router.add("GET", "/api/calendar/settings", () => calendar.getSettings());
  router.add("PATCH", "/api/calendar/settings", ({ body }) => calendar.updateSettings(body as Record<string, unknown>));

  router.add("GET", "/api/calendar/items", ({ query }) => {
    const kind = query.get("kind");
    const status = query.get("status");
    return calendar.listItems({
      ...(kind === "task" || kind === "reminder" ? { kind } : {}),
      ...(status === "open" || status === "done" ? { status } : {})
    });
  });
  router.add("POST", "/api/calendar/items", ({ body }) => calendar.createItem(body as never));
  router.add("PATCH", "/api/calendar/items/:id", ({ params, body }) => calendar.updateItem(params.id!, body as never));
  router.add("POST", "/api/calendar/items/:id/complete", async ({ params, body }) => {
    const occurrence = isObject(body) && typeof body.occurrenceDate === "string" ? body.occurrenceDate : undefined;
    await calendar.completeItem(params.id!, occurrence);
    return calendar.getItem(params.id!).catch(() => ({ id: params.id, completed: true }));
  }, 200);
  router.add("POST", "/api/calendar/items/:id/reopen", async ({ params }) => {
    await calendar.reopenItem(params.id!);
    return calendar.getItem(params.id!).catch(() => ({ id: params.id, reopened: true }));
  }, 200);
  router.add("DELETE", "/api/calendar/items/:id", async ({ params, query }) => {
    const scope = query.get("scope");
    await calendar.deleteItem(params.id!, scope === "occurrence" || scope === "future" || scope === "series" ? { scope } : {});
    return { deleted: params.id };
  });

  router.add("GET", "/api/calendar/view", async ({ query }) => {
    const mode = query.get("mode") ?? "week";
    const date = query.get("date") ? requireDate(query.get("date")!) : today(context);
    const items = await calendar.listItems();
    const events = await context.calendarEvents.read();
    if (mode === "day") return dayView(date, items, events, today(context));
    if (mode === "month") return monthView(monthParam(context, query), items, events, today(context));
    return weekView(date, items, events, today(context));
  });

  router.add("GET", "/api/calendar/today", async () => {
    const items = await calendar.listItems();
    const events = await context.calendarEvents.read();
    return todayStrip(today(context), items, events);
  });

  router.add("GET", "/api/calendar/overview", async ({ query }) => {
    const date = query.get("date") ? requireDate(query.get("date")!) : today(context);
    const items = await calendar.listItems();
    const events = await context.calendarEvents.read();
    return calendarOverview(date, monthOf(date), items, events, today(context));
  });

  router.add("GET", "/api/calendar/search", async ({ query }) => ({ items: searchItems(await calendar.listItems(), query.get("q") ?? "") }));
  router.add("GET", "/api/calendar/export.csv", async () => new RawResponse(itemsToCsv(await calendar.listItems()), "text/csv; charset=utf-8", "calendar-export.csv"));

  router.add("GET", "/api/calendar/prefs", async () => {
    const document = await context.calendarEvents.read();
    return {
      calendars: document.calendars.map((cal) => ({
        id: cal.id, name: cal.name, readOnly: cal.readOnly,
        highlight: document.prefs[cal.id]?.highlight ?? false,
        hidden: document.prefs[cal.id]?.hidden ?? false
      }))
    };
  });
  router.add("PATCH", "/api/calendar/prefs/:calendarId", ({ params, body }) => context.calendarEvents.update((draft) => {
    const id = params.calendarId!;
    const pref = draft.prefs[id] ?? { highlight: false, hidden: false };
    if (isObject(body) && typeof body.highlight === "boolean") pref.highlight = body.highlight;
    if (isObject(body) && typeof body.hidden === "boolean") pref.hidden = body.hidden;
    draft.prefs[id] = pref;
    return { id, ...pref };
  }), 200);
}
