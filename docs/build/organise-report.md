# Organise v1 — build report

Branch `feat/organise-v1`, from `origin/main` at `7148bd2`. Spec: `docs/design/organise-v1.md`, copied verbatim from the SPEC section of `docs/design/organiser.md`. Every default chosen where the spec is silent is in `docs/build/assumptions.md` (entries 100 onwards), each marked "assumed, revisit".

Baseline on `origin/main`: 208 tests, 206 pass, 0 fail, 2 skipped (Windows-only harness probes).

## Run Organise locally

```bash
pnpm install
pnpm run build
pnpm run viral-dev dashboard        # http://127.0.0.1:4174/#/organise
```

Data is stored in `.viral/dashboard/organise/` (`items.json`, `lists.json`, `trackers.json`, `rules.json`).

## Steps

Test counts are pass / fail / skipped for the full suite at that step's commit.

### Step 1 — shared item model and store: done (suite 214 / 0 / 2)
- **Files:** `src/dashboard/organise/{model,service,routes}.ts`; `src/dashboard/ui/organise/{common,detail,overview}.ts`; `src/dashboard/{server,http}.ts`; `src/dashboard/ui/{app.ts,styles.css}`; `tests/organise-{helpers,items}.ts`; assumptions; this report.
- **Routes:** `GET|POST /api/organise/items`, `GET|PATCH|DELETE /api/organise/items/:id`, and `GET /api/organise/meta`, which is extra; see assumption 108.
- **Tests:** `organise-items`, 8 cases: create, read, edit, delete; every validation failure; unknown id; atomic write and failed-write recovery; status rules per type; routes.
- **UI:** the Organise nav group, the Organise overview (items by type with quick-create), and the shared detail panel with the disabled "Ask Viral (connect a model later)" box. Browser-checked at 1920 and 1280: no console errors, no horizontal overflow; live edit, done status and quick-create worked.

### Step 2 — inbox: done (suite 219 / 0 / 2)
- **Files:** `src/dashboard/organise/{service,routes}.ts`; `src/dashboard/ui/organise/{inbox,overview}.ts`; `src/dashboard/ui/{app.ts,styles.css}`; `tests/organise-inbox.test.ts`; assumptions; this report.
- **Routes:** `POST /api/organise/inbox`, `POST /api/organise/inbox/:id/sort`; `GET /api/organise/inbox` and read-only `GET /api/organise/lists` are additions (assumptions 111 and 115).
- **Tests:** `organise-inbox`, 5 cases: add and count; each sort target (task, reminder, note, list item) keeping the id; sort-form validation; delete; routes.
- **UI:** the inbox at the top of the Organise overview (Enter adds), Sort with a per-type form, Delete, and the unsorted badge on the Organise nav item. Browser-checked at 1920 and 1280: no console errors, no overflow; capture, badge, sort to task, sort to reminder and delete all worked.

### Step 3 — tasks: done (suite 225 / 0 / 2)
- **Files:** `src/dashboard/organise/{tasks,service,routes}.ts`; `src/dashboard/organise/modules/{types,tasks,registry}.ts`; `src/dashboard/ui/organise/{tasks,filters,detail}.ts`; `src/dashboard/ui/{app.ts,styles.css}`; `tests/organise-tasks.test.ts`; assumptions; this report.
- **Routes:** `GET /api/organise/tasks` (addition, assumption 119). `GET /api/organise/items` gains `project_id`, `status`, `from` and `to` filters.
- **Tests:** `organise-tasks`, 6 cases: grouping boundaries (overdue, today, day 1, day 6, day 7, undated); complete and reopen; Done order; priority order; checklist changes with n of m; filters alone and combined; routes; the module registry.
- **UI:** the Tasks page with Today, This week, Later and Done, an overdue flag, n of m progress, priority, complete by checkbox, Reopen, and the filter bar; the checklist editor in the detail panel. Browser-checked at 1920 and 1280: no console errors, no overflow; grouping, complete and reopen, checklist tick and add, and the project filter all worked.

### Step 4 — reminders: done (suite 231 / 0 / 2)
- **Files:** `src/dashboard/organise/{reminders,model,service,routes}.ts`; `src/dashboard/organise/modules/{reminders,registry}.ts`; `src/dashboard/{timeline,server}.ts` (optional `origin` on timeline entries, Organise reminders added to the timeline); `src/dashboard/ui/organise/{reminders,detail}.ts`; `src/dashboard/ui/{calendar,app}.ts`; `styles.css`; `tests/organise-{reminders,tasks}.test.ts`; assumptions; this report.
- **Tests:** `organise-reminders`, 6 cases: yearly and custom next dates; leap-day series over four completions; next occurrence fields and no duplicates; prepare_by default, override, `prepare_days` and zero; overdue flag; calendar and Next 7 days entries including "Prepare:".
- **UI:** the Reminders page (Overdue, Upcoming, Done) with category tags, recurrence, prepare-by, complete and reopen; "days before" in the detail panel; calendar clicks open Organise reminders. Browser-checked at 1920 and 1280: no console errors, no overflow; grouping, the Personal default, yearly completion, calendar entries and click-through all worked.

### Step 5 — notes and lists: done (suite 236 / 0 / 2)
- **Files:** `src/dashboard/organise/{lists,service,routes}.ts`; `src/dashboard/organise/modules/{notes,lists,registry}.ts`; `src/dashboard/ui/organise/{notes,detail,filters}.ts`; `src/dashboard/ui/{app.ts,styles.css}`; `tests/organise-notes-lists.test.ts`; assumptions; this report.
- **Routes:** `GET|POST /api/organise/lists`, `GET|PATCH|DELETE /api/organise/lists/:id`.
- **Tests:** `organise-notes-lists`, 5 cases: default, preset and custom statuses with validation; row status from its list and done_at on the last status; status edits (no removing used ones, done_at follows), delete only when empty; notes with links to existing items only; routes.
- **UI:** the "Notes and lists" page with Notes and Lists tabs: compose notes (title optional), create lists from presets, edit statuses, add and edit rows with live status changes; the detail panel shows a row's list statuses. Browser-checked at 1920 and 1280: no console errors, no overflow; note, row status, add row, preset list and detail statuses all worked.

### Step 6 — projects: done (suite 240 / 0 / 2)
- **Files:** `src/dashboard/organise/{projects,service,routes}.ts`; `src/dashboard/organise/modules/{projects,registry}.ts`; `src/dashboard/ui/organise/projects.ts`; `src/dashboard/ui/{app.ts,styles.css}`; `tests/organise-projects.test.ts`; assumptions; this report.
- **Routes:** `GET /api/organise/projects/:id` (addition, assumption 132).
- **Tests:** `organise-projects`, 4 cases: project page contents and open-first order across all five sections; project on tasks and reminders at create and edit, and project statuses; the deletion rule (refused while in use, allowed when empty); routes.
- **UI:** the Projects list with status filter and create; the project page with editable name, status and description, Delete, and the five sections. Browser-checked at 1920 and 1280: no overflow; sections, open-first order, live status, refused delete with a message and create all worked. The only console line is the expected 400 from the refused delete.

### Step 7 — trackers: done (suite 246 / 0 / 2)
- **Files:** `src/dashboard/organise/{trackers,service,routes}.ts`; `src/dashboard/organise/modules/{trackers,registry}.ts`; `src/dashboard/ui/organise/trackers.ts`; `src/dashboard/ui/{app.ts,styles.css}`; `tests/organise-trackers.test.ts`; assumptions; this report.
- **Routes:** `GET|POST /api/organise/trackers`, `PATCH|DELETE /api/organise/trackers/:id`, `GET|POST /api/organise/trackers/:id/entries`, `PATCH|DELETE /api/organise/trackers/:id/entries/:entryId`.
- **Tests:** `organise-trackers`, 6 cases: week boundaries Monday to Sunday (including across a month end), month (including a leap February) and year boundaries; progress with and without a target; over-target; 0.1 + 0.2; history of 8 periods (weekly, monthly, yearly); entry edit and delete changing progress; validation and unknown ids; deleting a tracker deletes its entries; project link and the deletion rule; routes.
- **UI:** the Trackers page with a progress bar (value of target, percent, to go) or the total only, 8-period history, live entry add, edit and delete, and tracker settings. Browser-checked at 1920 and 1280: no console errors, no overflow; progress, history, no-target total and entry add, edit and delete all worked.

### Step 8 — weekly review: done (suite 251 / 0 / 2)
- **Files:** `src/dashboard/organise/{review,service,routes}.ts`; `src/dashboard/ui/organise/{review,overview}.ts`; `src/dashboard/ui/{app.ts,styles.css}`; `tests/organise-review.test.ts`; assumptions; this report.
- **Routes:** `GET /api/organise/review?end=YYYY-MM-DD` (default today).
- **Tests:** `organise-review`, 5 cases, all with fixed dates: window edges (first day in, the day before out, today in, explicit end); a reopened task not counted; done list items and tracker entries; trackers scaled to 7 days (weekly as is, monthly, yearly, no target); slipped tasks and reminders; routes.
- **UI:** the review page (Done, Slipped, Trackers) with a chosen end date, linked from the Organise overview. Browser-checked at 1920 and 1280: no console errors, no overflow; contents, the scaled tracker summary, click-through and the overview link all worked.

### Step 9 — auto-suggest and rules: done (suite 257 / 0 / 2)
- **Files:** `src/dashboard/organise/{suggest,service,routes}.ts`; `src/dashboard/ui/organise/{suggest,inbox,overview}.ts`; `src/dashboard/ui/{settings.ts,styles.css}`; `tests/organise-suggest.test.ts`; assumptions; this report.
- **Routes:** `GET|PATCH /api/organise/rules`; `POST /api/organise/suggest/:id/accept`, `/dismiss`, `/unmute`. `GET /api/organise/inbox` now carries each item's suggestions.
- **Tests:** `organise-suggest`, 6 cases: each date pattern alone (including the next-year and next-month cases) and turned off; the verb signal alone; both signals in order; no signal; accept records a count and does not apply anything; muting after three dismissals in a row (across items, reset by an accept, per pattern), the chip hidden per item, unmute; settings for verbs and date patterns with validation; routes.
- **UI:** suggestion chips with Accept and Dismiss on inbox rows (Accept opens the sort form pre-filled; a mute shows a message), and the "Organise suggestions" section in Settings (verbs, date-pattern toggles, muted list with Unmute). Browser-checked at 1920 and 1280: no console errors, no overflow; chips, accept, mute after three, unmute, toggle and verb edit all worked.

### Step 10 — search, filters, Today strip, export, Overview panels: done (suite 262 / 0 / 2)
- **Files:** `src/dashboard/organise/{overview,service,routes}.ts`; `src/dashboard/http.ts` (`RawResponse` for the CSV); `src/dashboard/ui/organise/{overview,panels,panel-types,panel-tasks,panel-reminders,panel-notes,panel-trackers,panel-review,notes,trackers}.ts`; `styles.css`; `tests/organise-overview.test.ts`; assumptions; this report.
- **Routes:** `GET /api/organise/today`, `GET /api/organise/search?q=`, `GET /api/organise/export.csv`; `GET /api/organise/overview` is an addition (assumption 153).
- **Tests:** `organise-overview`, 5 cases: search across title, notes, checklist and project name, grouped, with limits; filter combinations over HTTP; Today strip contents; export BOM, header, quoting, newlines, formula neutralising and headers; Overview counts.
- **UI:** the Organise overview (inbox with chips and badge, Today strip, search with grouped results, then the registered panels), plus filters on list rows and trackers. Browser-checked at 1920 and 1280: no console errors, no overflow; order, Today strip, panel order and counts, search and click-through, list-row filter and export bytes all worked.

## Summary

| Step | Commit | Status | New tests | Full suite (pass / fail / skipped) | Browser-checked |
|---|---|---|---|---|---|
| 0 Spec | `359441a` | done | — | 206 / 0 / 2 (baseline) | — |
| 1 Item model and store | `87090b7` | done | 8 | 214 / 0 / 2 | yes |
| 2 Inbox | `cb0e7d9` | done | 5 | 219 / 0 / 2 | yes |
| 3 Tasks | `917fdc3` | done | 6 | 225 / 0 / 2 | yes |
| 4 Reminders | `f555b1c` | done | 6 | 231 / 0 / 2 | yes |
| 5 Notes and lists | `8f09aaf` | done | 5 | 236 / 0 / 2 | yes |
| 6 Projects | `228f5ac` | done | 4 | 240 / 0 / 2 | yes |
| 7 Trackers | `c9ce8e8` | done | 6 | 246 / 0 / 2 | yes |
| 8 Weekly review | `320c67c` | done | 5 | 251 / 0 / 2 | yes |
| 9 Auto-suggest and rules | `0c241be` | done | 6 | 257 / 0 / 2 | yes |
| 10 Search, filters, Today, export, Overview | this commit | done | 5 | 262 / 0 / 2 | yes |

- **Existing tests:** all 208 pre-existing tests (206 pass, 2 skipped) kept passing at every step. No step needed the three-attempt failure rule, and none is partial or blocked.
- **Browser checks:** every step was checked in headless Chromium at 1920×1080 and 1280×800 before its commit, with a throwaway script that is not in the repo. No step is "UI not browser-checked". The UI itself still has no automated tests in `pnpm run test`; only the server, model and calculations do.

### Hard rules
- **Not touched:** the chat command layer (`chat.ts`, `commands/`), Finance and its validation, the action list, confirm/undo, the reply text, `STATE.json`, `STATE.md`, `CHECKPOINT.md`, `verification/`, `runs/`, `tasks/`, `packets/`, `.claude/` and `viral-dev.config.json`. No new setting was needed.
- **No model:** Ollama is not connected and no model is called. The "Ask Viral (connect a model later)" box is disabled and not wired. The future contract stays as the spec documents it: a model would receive only the selected item's fields and could call only named actions from the module registry (`src/dashboard/organise/modules/`) or named queries, never reading the store.
- **Existing dashboard files changed:**
  - `http.ts`: `/assets/ui/organise/` static path, and `RawResponse`.
  - `server.ts`: Organise service, routes, and reminders on the timeline.
  - `timeline.ts`: an optional `origin` field.
  - `ui/calendar.ts`: Organise reminders open in Organise.
  - `ui/app.ts`: nav group, badge, routes.
  - `ui/settings.ts`: the suggestions section.
  - `ui/styles.css`.

### Not done, and why
- **The earlier dashboard Reminders store** (`reminders.json`, M6) is not merged with Organise reminders. Merging would migrate user data and was not asked for. Its page leaves the nav but still works, and its reminders still show on the calendar (assumption 125). This is the one design question the spec does not settle; it is recorded as a default to revisit rather than a blocker.
- **Additions the spec did not list**, all recorded in assumptions: the routes `/meta`, `GET /inbox`, `/tasks`, `/reminders`, `/projects/:id` and `/overview`, and the internal `recurrence_anchor` field for leap-day birthdays.

### Questions
None. Every gap was covered by a recorded default, so `docs/build/organise-questions.md` was not needed.
