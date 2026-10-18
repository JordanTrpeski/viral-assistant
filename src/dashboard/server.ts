import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { monthBudget, weekBudget } from "./budget.js";
import { buildCalendar, itemsInWindow } from "./calendar.js";
import { ChatService } from "./chat.js";
import { OllamaProposer } from "./commands/ollama.js";
import { PlaceholderProposer, type Proposer } from "./commands/proposer.js";
import type { LocalModel } from "../local/types.js";
import { ValidationError } from "./errors.js";
import { FinanceService, type TransactionFilter } from "./finance.js";
import { financePortFor, GroceriesService } from "./groceries.js";
import { dashboardStatics, listen, Router, type RunningServer } from "./http.js";
import { colourCategories, isColourCategory, type ColourCategory } from "./shared/colours.js";
import { localIsoDate, monthOf } from "./shared/dates.js";
import { nextSevenDays, reminderPanel } from "./overview.js";
import { reminderTimelineItems, RemindersService, type ReminderStatus } from "./reminders.js";
import { financeSummary } from "./summary.js";
import { prepareEntries, transactionTimelineItems, type TimelineItem } from "./timeline.js";
import { requireDate, requireMonth, requirePositiveInteger } from "./validation.js";

/** Everything the routes need; tests build one against temp directories and a fixed clock. */
export interface DashboardContext {
  finance: FinanceService;
  groceries: GroceriesService;
  reminders: RemindersService;
  chat: ChatService;
  budgetStepCents: number;
  clock: () => Date;
  startedAt: Date;
}

export interface DashboardOptions {
  /** Base data directory; finance lives in `<dataDir>/finance`, other modules in `<dataDir>/dashboard`. */
  dataDir: string;
  budgetStepCents: number;
  /** Largest amount a chat proposal may carry, in cents (default 5000 EUR). */
  chatMaxAmountCents?: number;
  /** Explicit proposer; tests inject a stub. Overrides the model-backed/placeholder choice below. */
  proposer?: Proposer;
  /** Loopback Ollama model for the chat proposer; when present (and enabled) the model-backed proposer is used. */
  localModel?: LocalModel;
  /** Chat proposer settings from config. */
  chat?: { model: string; timeoutMs: number; proposerEnabled: boolean };
  clock?: () => Date;
}

export function createDashboardContext(options: DashboardOptions): DashboardContext {
  const clock = options.clock ?? (() => new Date());
  const finance = FinanceService.open(join(options.dataDir, "finance"), { clock });
  // Swap point: an explicit proposer (tests) wins; otherwise the model-backed OllamaProposer when enabled; else the placeholder.
  const proposer: Proposer = options.proposer
    ?? (options.localModel && options.chat && options.chat.proposerEnabled
      ? new OllamaProposer(options.localModel, { model: options.chat.model, timeoutMs: options.chat.timeoutMs }, async () => (await finance.snapshot()).categories)
      : new PlaceholderProposer());
  return {
    finance,
    groceries: GroceriesService.open(join(options.dataDir, "dashboard"), financePortFor(finance), { clock }),
    reminders: RemindersService.open(join(options.dataDir, "dashboard"), { clock }),
    chat: new ChatService(join(options.dataDir, "dashboard", "chat"), {
      clock, finance, proposer, ...(options.chatMaxAmountCents ? { maxAmountCents: options.chatMaxAmountCents } : {})
    }),
    budgetStepCents: options.budgetStepCents,
    clock,
    startedAt: clock()
  };
}

function today(context: DashboardContext): string {
  return localIsoDate(context.clock());
}

function monthParam(context: DashboardContext, query: URLSearchParams): string {
  const value = query.get("month");
  return value === null ? monthOf(today(context)) : requireMonth(value);
}

export function registerCoreRoutes(router: Router, context: DashboardContext): void {
  router.add("GET", "/api/status", () => ({
    daemon: "online",
    startedAt: context.startedAt.toISOString(),
    uptimeSeconds: Math.max(0, Math.floor((context.clock().getTime() - context.startedAt.getTime()) / 1_000)),
    today: today(context),
    tokensToday: null,
    tokensNote: "Viral does not record token usage yet; the efficiency telemetry has no token counts."
  }));
  router.add("GET", "/api/settings", async () => ({ ...(await context.finance.getSettings()), budgetStepCents: context.budgetStepCents }));
  router.add("PATCH", "/api/settings", async ({ body }) => ({ ...(await context.finance.updateSettings(body)), budgetStepCents: context.budgetStepCents }));
}

export function registerFinanceRoutes(router: Router, context: DashboardContext): void {
  const finance = context.finance;
  router.add("GET", "/api/finance/categories", () => finance.listCategories());
  router.add("POST", "/api/finance/categories", ({ body }) => finance.createCategory(body));
  router.add("PATCH", "/api/finance/categories/:id", ({ params, body }) => finance.updateCategory(params.id!, body));
  router.add("DELETE", "/api/finance/categories/:id", ({ params }) => finance.deleteCategory(params.id!));

  router.add("GET", "/api/finance/transactions", ({ query }) => {
    const month = query.get("month");
    const type = query.get("type");
    return finance.listTransactions({ ...(month ? { month } : {}), ...(type ? { type: type as TransactionFilter } : {}) });
  });
  router.add("POST", "/api/finance/transactions", ({ body }) => finance.createTransaction(body));
  router.add("GET", "/api/finance/transactions/:id", ({ params }) => finance.getTransaction(params.id!));
  router.add("PATCH", "/api/finance/transactions/:id", ({ params, body }) => finance.updateTransaction(params.id!, body));
  router.add("DELETE", "/api/finance/transactions/:id", ({ params }) => finance.deleteTransaction(params.id!));

  router.add("GET", "/api/finance/targets", () => finance.listTargets());
  router.add("PATCH", "/api/finance/targets/:categoryId", ({ params, body }) => finance.setTarget(params.categoryId!, body));
  router.add("POST", "/api/finance/targets/:categoryId/step", ({ params, body }) => finance.stepTarget(params.categoryId!, body, context.budgetStepCents), 200);

  router.add("GET", "/api/finance/summary", async ({ query }) => financeSummary(await finance.snapshot(), monthParam(context, query), today(context)));
  router.add("GET", "/api/budget", async ({ query }) => {
    const raw = query.get("date");
    const date = raw === null ? today(context) : requireDate(raw);
    const document = await finance.snapshot();
    return { date, stepCents: context.budgetStepCents, week: weekBudget(document, date), month: monthBudget(document, monthOf(date)) };
  });
}

export function registerGroceriesRoutes(router: Router, context: DashboardContext): void {
  const groceries = context.groceries;
  router.add("GET", "/api/groceries/items", () => groceries.listItems());
  router.add("POST", "/api/groceries/items", ({ body }) => groceries.addItem(body));
  router.add("PATCH", "/api/groceries/items/:id", ({ params, body }) => groceries.updateItem(params.id!, body));
  router.add("DELETE", "/api/groceries/items/:id", ({ params }) => groceries.deleteItem(params.id!));

  router.add("GET", "/api/groceries/templates", () => groceries.listTemplates());
  router.add("POST", "/api/groceries/templates", ({ body }) => groceries.createTemplate(body));
  router.add("PATCH", "/api/groceries/templates/:id", ({ params, body }) => groceries.updateTemplate(params.id!, body));
  router.add("DELETE", "/api/groceries/templates/:id", ({ params }) => groceries.deleteTemplate(params.id!));
  router.add("POST", "/api/groceries/templates/:id/start", ({ params }) => groceries.startTemplate(params.id!), 200);

  router.add("GET", "/api/groceries/prices", () => groceries.prices());
  router.add("POST", "/api/groceries/prices", ({ body }) => groceries.addPrice(body));
  router.add("PATCH", "/api/groceries/prices/:id", ({ params, body }) => groceries.updatePrice(params.id!, body));
  router.add("DELETE", "/api/groceries/prices/:id", ({ params }) => groceries.deletePrice(params.id!));

  router.add("GET", "/api/groceries/trips", () => groceries.listTrips());
  router.add("POST", "/api/groceries/trips", ({ body }) => groceries.completeTrip(body));
  router.add("GET", "/api/groceries/trips/:id", ({ params }) => groceries.getTrip(params.id!));
  router.add("PATCH", "/api/groceries/trips/:id", ({ params, body }) => groceries.updateTrip(params.id!, body));
  router.add("DELETE", "/api/groceries/trips/:id", ({ params }) => groceries.deleteTrip(params.id!));
}

/** Every dated entry from every source, including the derived prepare-by entries. */
export async function timelineItems(context: DashboardContext): Promise<TimelineItem[]> {
  const date = today(context);
  const items = [...transactionTimelineItems(await context.finance.snapshot(), date), ...reminderTimelineItems(await context.reminders.list())];
  return [...items, ...prepareEntries(items, date)];
}

function hiddenParam(query: URLSearchParams): Set<ColourCategory> {
  const raw = query.get("hidden");
  if (!raw) return new Set();
  const values = raw.split(",").filter(Boolean);
  const unknown = values.filter((value) => !isColourCategory(value));
  if (unknown.length) throw new ValidationError(`hidden must list colour categories from: ${colourCategories.join(", ")} (unknown: ${unknown.join(", ")})`);
  return new Set(values as ColourCategory[]);
}

export function registerTimelineRoutes(router: Router, context: DashboardContext): void {
  router.add("GET", "/api/calendar", async ({ query }) => buildCalendar(await timelineItems(context), monthParam(context, query), today(context), hiddenParam(query)));
  router.add("GET", "/api/timeline", async ({ query }) => {
    const rawFrom = query.get("from");
    const rawDays = query.get("days");
    const from = rawFrom === null ? today(context) : requireDate(rawFrom, "from");
    const days = rawDays === null ? 7 : requirePositiveInteger(Number(rawDays), "days");
    if (days > 366) throw new ValidationError("days must be at most 366");
    return { from, days, items: itemsInWindow(await timelineItems(context), from, days) };
  });
}

export function registerReminderRoutes(router: Router, context: DashboardContext): void {
  const reminders = context.reminders;
  router.add("GET", "/api/reminders", ({ query }) => reminders.list((query.get("status") ?? "all") as ReminderStatus));
  router.add("POST", "/api/reminders", ({ body }) => reminders.create(body));
  router.add("GET", "/api/reminders/:id", ({ params }) => reminders.get(params.id!));
  router.add("PATCH", "/api/reminders/:id", ({ params, body }) => reminders.update(params.id!, body));
  router.add("DELETE", "/api/reminders/:id", ({ params }) => reminders.delete(params.id!));
}

export function registerChatRoutes(router: Router, context: DashboardContext): void {
  const chat = context.chat;
  router.add("GET", "/api/chat/threads", () => chat.listThreads());
  router.add("POST", "/api/chat/threads", ({ body }) => chat.createThread(body));
  router.add("PATCH", "/api/chat/threads/:id", ({ params, body }) => chat.renameThread(params.id!, body));
  router.add("DELETE", "/api/chat/threads/:id", ({ params }) => chat.deleteThread(params.id!));
  router.add("GET", "/api/chat/threads/:id/messages", ({ params }) => chat.listMessages(params.id!));
  router.add("POST", "/api/chat/threads/:id/messages", ({ params, body }) => chat.postMessage(params.id!, body));
  router.add("POST", "/api/chat/proposals/:id/confirm", ({ params }) => chat.confirm(params.id!), 200);
  router.add("POST", "/api/chat/proposals/:id/cancel", ({ params }) => chat.cancel(params.id!), 200);
  router.add("POST", "/api/chat/clarifications/:id/answer", ({ params, body }) => chat.answerClarification(params.id!, body), 200);
  router.add("POST", "/api/chat/undo/:token", ({ params }) => chat.undo(params.token!), 200);
}

export function registerOverviewRoutes(router: Router, context: DashboardContext): void {
  router.add("GET", "/api/overview", async () => {
    const date = today(context);
    const items = await timelineItems(context);
    const document = await context.finance.snapshot();
    return {
      today: date,
      nextSevenDays: nextSevenDays(items, date),
      reminders: reminderPanel(items, date),
      // Read-only on the Overview: no stepCents, so the budget widget exposes no edit control. Targets are edited in Finance.
      budget: { date, week: weekBudget(document, date), month: monthBudget(document, monthOf(date)) }
    };
  });
}

export function createRouter(context: DashboardContext): Router {
  const router = new Router();
  registerCoreRoutes(router, context);
  registerFinanceRoutes(router, context);
  registerGroceriesRoutes(router, context);
  registerTimelineRoutes(router, context);
  registerOverviewRoutes(router, context);
  registerReminderRoutes(router, context);
  registerChatRoutes(router, context);
  return router;
}

/** Compiled location: dist/src/dashboard. Page and stylesheet are read from src/dashboard/ui; browser modules from dist. */
const compiledDir = dirname(fileURLToPath(import.meta.url));
const uiSourceDir = join(compiledDir, "..", "..", "..", "src", "dashboard", "ui");

export async function startDashboardServer(context: DashboardContext, host: string, port: number): Promise<RunningServer> {
  return listen(createRouter(context), dashboardStatics(uiSourceDir, compiledDir), host, port);
}
