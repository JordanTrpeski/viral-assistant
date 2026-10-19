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
