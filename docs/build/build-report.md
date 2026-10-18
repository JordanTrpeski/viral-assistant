# Dashboard build — report

Branch: `feat/dashboard-build`, started from `origin/main` at `355721a`. Not merged; the merge decision is yours.
All six milestones are **done** and green. Every decision made without asking is in [`assumptions.md`](assumptions.md) (63 entries, each marked "assumed, revisit").

## Run it locally

```bash
pnpm install
pnpm run build                          # compiles the server and the browser modules into dist/
pnpm run viral-dev dashboard            # → http://127.0.0.1:4174
# options: --port <n>   --data-dir <dir>   (default data dir: .viral/ in the repo)
```

On Windows PowerShell the commands are the same. To start from clean data: `Remove-Item -Recurse -Force .viral\finance, .viral\dashboard`, or `rm -rf .viral/finance .viral/dashboard` in bash.

Verification, as run before every push:

```bash
rm -rf dist            # PowerShell: Remove-Item -Recurse -Force dist
pnpm run typecheck && pnpm run lint && pnpm run test
```

## Status per milestone

Test counts are **pass / fail / skipped**. "Milestone tests" are the new test file for that milestone. "Full suite" is the whole repository at that commit. The 2 skips are pre-existing Windows-only harness probes; the baseline on `main` was 106 / 0 / 2.

| Milestone | Commit | Status | Milestone tests | Full suite |
|---|---|---|---|---|
| M1 Data model | `7dc88b6` | done | 16 / 0 / 0 (`dashboard-model`) | 122 / 0 / 2 |
| M2 Finance | `cf74d89` | done | 12 / 0 / 0 (`dashboard-finance`) | 134 / 0 / 2 |
| M3 Groceries | `f7fca09` | done | 10 / 0 / 0 (`dashboard-groceries`) | 144 / 0 / 2 |
| M4 Calendar | `6eb31e6` | done | 6 / 0 / 0 (`dashboard-calendar`) | 150 / 0 / 2 |
| M5 Overview | `6db6cfa` | done | 5 / 0 / 0 (`dashboard-overview`) | 155 / 0 / 2 |
| M6 Reminders | this commit | done | 6 / 0 / 0 (`dashboard-reminders`) | **161 / 0 / 2** |

No milestone hit the three-attempt failure rule.

### Files changed

- **M1:** `.gitignore` (adds `.viral/finance/`, `.viral/dashboard/`), `docs/build/assumptions.md`, `src/dashboard/{errors,finance,store,timeline,validation}.ts`, `src/dashboard/shared/{colours,dates,money}.ts`, `tests/dashboard-helpers.ts`, `tests/dashboard-model.test.ts`
- **M2:** `src/cli.ts` (new `dashboard` command), `viral-dev.config.json` (new `dashboard` section), `src/dashboard/{budget,config,http,server,summary}.ts`, `src/dashboard/ui/{api,app,budget-view,dom,finance,settings}.ts`, `src/dashboard/ui/{index.html,styles.css}`, `tests/dashboard-finance.test.ts`, `tests/dashboard-helpers.ts`, assumptions
- **M3:** `src/dashboard/groceries.ts`, `src/dashboard/ui/groceries.ts`, `src/dashboard/server.ts`, `src/dashboard/ui/{api,app}.ts`, `styles.css`, `tests/dashboard-groceries.test.ts`, assumptions
- **M4:** `src/dashboard/calendar.ts`, `src/dashboard/ui/{calendar,overview}.ts`, `src/dashboard/{server,timeline}.ts`, `src/dashboard/ui/app.ts`, `styles.css`, `tests/dashboard-calendar.test.ts`, assumptions
- **M5:** `src/dashboard/overview.ts`, `src/dashboard/ui/overview.ts`, `src/dashboard/server.ts`, `styles.css`, `tests/dashboard-overview.test.ts`, assumptions
- **M6:** `src/dashboard/reminders.ts`, `src/dashboard/ui/reminders.ts`, `src/dashboard/{server,timeline}.ts`, `src/dashboard/ui/app.ts`, `styles.css`, `tests/dashboard-reminders.test.ts`, `tests/dashboard-calendar.test.ts` (prepare-by status rule, see assumption 47), assumptions, this report

### Protected files

**Not touched:** `STATE.json`, `STATE.md`, `CHECKPOINT.md`, `verification/`, `runs/`, `tasks/`, `packets/`, `.claude/`.

**`viral-dev.config.json`** was changed once, in M2, as the brief allows. It gained a new `dashboard` section (`host` 127.0.0.1, `port` 4174, `budgetStepCents` 1000) and nothing else in the file changed. `.gitignore` gained the two data folders.

## What each test file covers

Each milestone's tests cover create, read, edit, delete, validation failure (400), unknown id (404), atomic write, cent arithmetic, and its calculations.

- **Atomic write:** a temp file plus rename leaves no temp files behind. A rename forced to fail keeps both the file on disk and the in-memory state. Twenty concurrent updates lose none. A corrupt file is reported, never overwritten.
- **Cents:** euro parsing and formatting; `0.1 + 0.2` style sums; trip totals of quantity × unit price (3 × 0.99 + 2 × 1.49 = 5.95); prorated targets rounded to the cent.
- **Calculations:**
  - Balance, and income and spent this month, counting only dates up to today.
  - Runway over a 90-day window, including the case of a negative balance.
  - Week boundaries:
    - Sunday 1 November is a one-day week.
    - Monday 2 November starts a full week.
    - 26–31 October is cut at the month end.
  - The month view: committed bills never split into weeks.
  - "+N more", with hidden legend categories excluded; the Monday-first grid; the 7-day window; the reminders panel (overdue, 30-day limit, at most 8).
  - Price watch percentages; prepare-by defaults and overdue rules.
- **Cross-module:** a completed trip writes exactly one Finance expense and shows in the Overview budget. A failed trip save rolls the expense back. Changes in Finance appear on the Overview; the Overview budget is read-only (no − / +), and budget targets are edited only in Finance > Budget.
- **Routes:** 400 and 404 bodies; 405 for a wrong method; 415 for a non-JSON body; 403 for a non-loopback Host header (DNS-rebinding defence); the static allow-list.

**Browser checks (not part of `pnpm run test`).** At each milestone I drove the real page in headless Chromium at 1920×1080 and 1280×800:
- live add, edit and delete; the zero-amount error; − / +;
- tick, price, complete trip and template Start;
- "+N more", legend hide/show (remembered across reload), and click-through to the owning module;
- adding a personal reminder, its prepare-by, the overdue flag, and done.

The checks reported no console errors and no horizontal overflow. They caught two real bugs, both fixed before commit:
- Template "Start" returned 415, because the client sent no JSON body.
- The Reminders table was cramped at 1280px.

These scripts were throwaway and are not in the repo, so **the UI has no automated tests in the suite**; only the server and the calculations do.

## API (loopback only, JSON)

`GET /api/status` · `GET|PATCH /api/settings` ·
`GET|POST /api/finance/categories`, `PATCH|DELETE /api/finance/categories/:id` ·
`GET|POST /api/finance/transactions` (`?month=YYYY-MM&type=all|fixed|flexible|income`), `GET|PATCH|DELETE /api/finance/transactions/:id` ·
`GET /api/finance/targets`, `PATCH /api/finance/targets/:categoryId`, `POST /api/finance/targets/:categoryId/step` (`{period, direction}`) ·
`GET /api/finance/summary` (`?month`) · `GET /api/budget` (`?date`) ·
`GET|POST /api/groceries/items`, `PATCH|DELETE /api/groceries/items/:id` ·
`GET|POST /api/groceries/templates`, `PATCH|DELETE /api/groceries/templates/:id`, `POST /api/groceries/templates/:id/start` ·
`GET|POST /api/groceries/prices`, `PATCH|DELETE /api/groceries/prices/:id` ·
`GET|POST /api/groceries/trips` (POST completes a trip), `GET|PATCH|DELETE /api/groceries/trips/:id` ·
`GET /api/calendar` (`?month&hidden=bills,…`) · `GET /api/timeline` (`?from&days`) · `GET /api/overview` ·
`GET|POST /api/reminders` (`?status=open|done|all`), `GET|PATCH|DELETE /api/reminders/:id`

## Chat (text, UI only)

Added after M6 in commit "feat(dashboard): text chat UI with placeholder replies". It needs no setup beyond the commands above.

**Works:**
- The chat pane replaces the old placeholder at the bottom of the Overview's right column.
- Threads: "Main" always exists; "+ New" creates a named thread (1–40 characters); click a tab to switch; rename with ✎ or a double-click; delete with ✕ (immediate). Main cannot be renamed or deleted.
- Messages: a scrolling list, with your messages on the right and replies on the left. Enter sends and Shift+Enter adds a new line, or use Send. Text is trimmed and must be 1–2000 characters.
- Expand / Collapse: the chat takes over the Overview area, and the calendar and other panels collapse. The choice is remembered in this browser.
- Storage: one atomic JSON file per thread in `.viral/dashboard/chat/`. The note "Kept until you delete it. Retention rule not decided yet." appears under the tabs.
- Routes: `GET|POST /api/chat/threads`, `PATCH|DELETE /api/chat/threads/:id`, `GET|POST /api/chat/threads/:id/messages` (POST returns `{ message, reply }`). Bad names or text return 400, unknown thread ids return 404, and changes to Main return 400.
- Tests: `tests/dashboard-chat.test.ts`, 7 / 0 / 0.

**Placeholder or not built:**
- Every reply is the fixed text "Chat is not connected to a model yet." There is no Ollama or other model connection, no action parsing, and no voice.
- There is no retention rule and no automatic deletion.
- At 1280×800 the pane in the right column only shows about two messages, so Expand is the practical way to use it at that size.

## Not done, and why

- **Chat replies and voice:** the text chat UI and storage were added later (see Chat above), but replies are a fixed placeholder; no model and no voice are connected.
- **Gym, Projects, Viral tasks:** greyed out and non-functional, as designed. Reminders is functional; see assumption 56 for how I read the brief's wording.
- **Today's token count:** shows "n/a". Viral records no token usage anywhere (the efficiency telemetry has no token fields), so there is nothing truthful to display. Wiring a real source is a separate change.
- **Served by "the existing daemon":** there is no HTTP daemon on `main`. The desktop daemon lives only on the unmerged `feat/m06-desktop-final` and `feat/m05-voice-clean` branches. This build adds its own small loopback server (`viral-dev dashboard`). If the desktop daemon is merged later, the router in `src/dashboard/server.ts` can be mounted there (assumption 7).

## Known limitations worth a look before merging

1. **Editing a trip's expense directly in Finance does not update the trip.** The trip keeps its own item total. The reverse direction is handled: editing the trip updates the expense. Deleting the expense in Finance marks the trip "Expense deleted in Finance".
2. **Any process on this machine can call the API.** There is no token or login, only loopback binding, Host checks and JSON-only writes. That suits a single-user desktop, but not a shared machine.
3. **Weekly targets on cut weeks are prorated** (assumption 22). If you would rather have the full weekly target on a one-day week, it is a one-line change in `src/dashboard/budget.ts`.
4. **"Today" is the server machine's local date.** Clients in another time zone would see the server's day.
5. **There is no backup or undo.** Deletes are immediate, as the design requires ("no confirmation steps"), so a mis-click on Delete is permanent.
6. **Data stays local** under `.viral/`, which is ignored by git, and is never committed.
