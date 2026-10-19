// Viral dashboard shell: top bar, left navigation and page routing (hash based).
import { localIsoDate } from "../shared/dates.js";
import { api, type AppContext } from "./api.js";
import { h } from "./dom.js";
import { renderFinance } from "./finance.js";
import { renderGroceries } from "./groceries.js";
import { renderOrganiseOverview } from "./organise/overview.js";
import { renderNotesAndLists } from "./organise/notes.js";
import { renderProjects } from "./organise/projects.js";
import { renderOrganiseReminders } from "./organise/reminders.js";
import { renderReview } from "./organise/review.js";
import { renderTasks } from "./organise/tasks.js";
import { renderTrackers } from "./organise/trackers.js";
import { renderOverview } from "./overview.js";
import { renderReminders } from "./reminders.js";
import { renderSettings } from "./settings.js";

type Renderer = (container: HTMLElement, context: AppContext) => Promise<void>;

interface NavItem {
  route: string;
  label: string;
  render?: Renderer;
  /** Shown under a group heading in the nav. */
  group?: string;
  /** Routable but not listed in the nav (e.g. the weekly review, opened from a link). */
  hidden?: boolean;
}

/** Items without a renderer are shown greyed out and cannot be opened in this build. */
const navItems: NavItem[] = [
  { route: "overview", label: "Overview", render: renderOverview },
  { route: "finance", label: "Finance", render: renderFinance },
  { route: "groceries", label: "Groceries", render: renderGroceries },
  // The earlier dashboard Reminders page stays reachable (calendar links, its own data) but leaves the nav to Organise > Reminders.
  { route: "reminders", label: "Reminders", render: renderReminders, hidden: true },
  { route: "organise", label: "Overview", render: renderOrganiseOverview, group: "Organise" },
  { route: "organise-tasks", label: "Tasks", render: renderTasks, group: "Organise" },
  { route: "organise-reminders", label: "Reminders", render: renderOrganiseReminders, group: "Organise" },
  { route: "organise-notes", label: "Notes and lists", render: renderNotesAndLists, group: "Organise" },
  { route: "organise-projects", label: "Projects", render: renderProjects, group: "Organise" },
  { route: "organise-trackers", label: "Trackers", render: renderTrackers, group: "Organise" },
  { route: "organise-review", label: "Weekly review", render: renderReview, group: "Organise", hidden: true },
  { route: "gym", label: "Gym" },
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
  const route = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] ?? "";
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
    void updateInboxBadge();
    if (focused) document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focused)}"]`)?.focus();
  }
};

function navLink(item: NavItem, active: string): HTMLElement {
  const indent = item.group ? " nav-sub" : "";
  if (!item.render) return h("span", { class: `nav-item disabled${indent}`, title: "Not available in this build", "aria-disabled": "true" }, item.label);
  return h("a", { class: `nav-item${indent}${item.route === active ? " active" : ""}`, href: `#/${item.route}`, dataset: { route: item.route } }, item.label);
}

function renderNav(active: string): void {
  const entries: HTMLElement[] = [];
  let group: string | undefined;
  for (const item of navItems.filter((candidate) => !candidate.hidden)) {
    if (item.group && item.group !== group) entries.push(h("div", { class: "nav-group" }, item.group));
    group = item.group;
    entries.push(navLink(item, active));
  }
  nav.replaceChildren(...entries, h("div", { class: "nav-bottom" }, navLink(settingsItem, active)));
}

/** Unsorted inbox count as a badge on the Organise nav item. */
async function updateInboxBadge(): Promise<void> {
  try {
    const { count } = await api<{ count: number }>("GET", "/api/organise/inbox");
    const link = nav.querySelector<HTMLElement>("[data-route='organise']");
    if (!link) return;
    link.querySelector(".nav-badge")?.remove();
    if (count > 0) link.append(h("span", { class: "nav-badge", title: `${count} unsorted in the inbox` }, String(count)));
  } catch { /* the badge is a convenience; the page works without it */ }
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
