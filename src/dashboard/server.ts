import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { monthBudget, weekBudget } from "./budget.js";
import { FinanceService, type TransactionFilter } from "./finance.js";
import { dashboardStatics, listen, Router, type RunningServer } from "./http.js";
import { localIsoDate, monthOf } from "./shared/dates.js";
import { financeSummary } from "./summary.js";
import { requireDate, requireMonth } from "./validation.js";

/** Everything the routes need; tests build one against temp directories and a fixed clock. */
export interface DashboardContext {
  finance: FinanceService;
  budgetStepCents: number;
  clock: () => Date;
  startedAt: Date;
}

export interface DashboardOptions {
  /** Base data directory; finance lives in `<dataDir>/finance`, other modules in `<dataDir>/dashboard`. */
  dataDir: string;
  budgetStepCents: number;
  clock?: () => Date;
}

export function createDashboardContext(options: DashboardOptions): DashboardContext {
  const clock = options.clock ?? (() => new Date());
  return {
    finance: FinanceService.open(join(options.dataDir, "finance"), { clock }),
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

export function createRouter(context: DashboardContext): Router {
  const router = new Router();
  registerCoreRoutes(router, context);
  registerFinanceRoutes(router, context);
  return router;
}

/** Compiled location: dist/src/dashboard. Page and stylesheet are read from src/dashboard/ui; browser modules from dist. */
const compiledDir = dirname(fileURLToPath(import.meta.url));
const uiSourceDir = join(compiledDir, "..", "..", "..", "src", "dashboard", "ui");

export async function startDashboardServer(context: DashboardContext, host: string, port: number): Promise<RunningServer> {
  return listen(createRouter(context), dashboardStatics(uiSourceDir, compiledDir), host, port);
}
