// Viral dashboard shell: top bar, left navigation and page routing (hash based).
import { localIsoDate } from "../shared/dates.js";
import { api, type AppContext } from "./api.js";
import { h } from "./dom.js";
import { renderFinance } from "./finance.js";
import { renderGroceries } from "./groceries.js";
import { renderSettings } from "./settings.js";

type Renderer = (container: HTMLElement, context: AppContext) => Promise<void>;

interface NavItem {
  route: string;
  label: string;
  render?: Renderer;
}

function placeholder(title: string, text: string): Renderer {
  return async (container) => { container.replaceChildren(h("div", { class: "page" }, h("section", { class: "panel narrow" }, h("h3", {}, title), h("p", { class: "muted" }, text)))); };
}

/** Items without a renderer are shown greyed out and cannot be opened in this build. */
const navItems: NavItem[] = [
  { route: "overview", label: "Overview", render: placeholder("Overview", "The Overview is assembled in a later milestone of this build.") },
  { route: "finance", label: "Finance", render: renderFinance },
  { route: "groceries", label: "Groceries", render: renderGroceries },
  { route: "gym", label: "Gym" },
  { route: "reminders", label: "Reminders" },
  { route: "projects", label: "Projects" },
  { route: "viral-tasks", label: "Viral tasks" }
];
const settingsItem: NavItem = { route: "settings", label: "Settings", render: renderSettings };

interface Status {
  daemon: string;
  tokensToday: number | null;
  tokensNote: string;
}

const main = h("main", { class: "main", id: "main" });
const statusDot = h("span", { class: "dot offline" });
const statusText = h("span", {}, "Connecting…");
const tokens = h("span", { class: "muted" }, "Tokens today: —");
const toast = h("div", { class: "toast", role: "alert" });
const nav = h("nav", { class: "nav", "aria-label": "Modules" });
let toastTimer: number | undefined;

function currentRoute(): string {
  const route = location.hash.replace(/^#\/?/, "").split("/")[0] ?? "";
  return [...navItems, settingsItem].some((item) => item.route === route && item.render) ? route : "overview";
}

const context: AppContext = {
  today: localIsoDate(new Date()),
  notify(message: string) {
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 5_000);
  },
  navigate(route: string) {
    location.hash = `#/${route}`;
  },
  async refresh() {
    context.today = localIsoDate(new Date());
    const route = currentRoute();
    const item = [...navItems, settingsItem].find((candidate) => candidate.route === route);
    const focused = (document.activeElement as HTMLElement | null)?.dataset.focus;
    renderNav(route);
    try { await item?.render?.(main, context); }
    catch (error) { context.notify((error as Error).message); }
    if (focused) document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focused)}"]`)?.focus();
  }
};

function navLink(item: NavItem, active: string): HTMLElement {
  if (!item.render) return h("span", { class: "nav-item disabled", title: "Not available in this build", "aria-disabled": "true" }, item.label);
  return h("a", { class: `nav-item${item.route === active ? " active" : ""}`, href: `#/${item.route}` }, item.label);
}

function renderNav(active: string): void {
  nav.replaceChildren(...navItems.map((item) => navLink(item, active)), h("div", { class: "nav-bottom" }, navLink(settingsItem, active)));
}

async function pollStatus(): Promise<void> {
  try {
    const status = await api<Status>("GET", "/api/status");
    statusDot.className = "dot online";
    statusText.textContent = `Daemon ${status.daemon}`;
    tokens.textContent = `Tokens today: ${status.tokensToday === null ? "n/a" : status.tokensToday.toLocaleString()}`;
    tokens.title = status.tokensNote;
  } catch {
    statusDot.className = "dot offline";
    statusText.textContent = "Daemon offline";
  }
}

export function start(): void {
  document.body.replaceChildren(h("div", { class: "app" },
    h("header", { class: "topbar" }, h("strong", { class: "brand" }, "Viral"), h("span", { class: "status" }, statusDot, statusText), tokens),
    nav, main, toast));
  window.addEventListener("hashchange", () => { void context.refresh(); });
  void context.refresh();
  void pollStatus();
  window.setInterval(() => { void pollStatus(); }, 10_000);
}

start();
