# Reminders — gap report

Scope of this report: compare the stated Reminders design against the code, without changing any
Reminders code. Design checked:

- a reminder has **title, date, category, optional prepare_by**;
- **personal dates appear as calendar entries and as reminders**;
- **prepare_by shows on the Overview and on the calendar**;
- the **Reminders section is a page in the left nav**.

Files read: `src/dashboard/reminders.ts`, `src/dashboard/ui/reminders.ts`, plus the supporting
`src/dashboard/timeline.ts`, `src/dashboard/calendar.ts`, `src/dashboard/overview.ts`,
`src/dashboard/server.ts`, `src/dashboard/ui/{overview,calendar,app}.ts`, and the M6 entries in
`docs/build/build-report.md` (status table row "M6 Reminders", assumptions 47–62).

## Summary

**All four named design elements are present** — none is missing:

| Design element | Status | Where |
|---|---|---|
| title / date / category / optional prepare_by | **Implemented** | `reminders.ts` model + `create`/`update` validation; `ui/reminders.ts` add + inline-edit rows |
| personal dates appear as calendar entries **and** as reminders | **Implemented** | `reminderTimelineItems` → `timelineItems()` → `buildCalendar`; and the Reminders list / server `list` |
| prepare_by shows on the Overview **and** on the calendar | **Implemented** | `prepareEntries` (grey "Prepare: …") → calendar; `overview.reminderPanel` includes `source === "prepare"` |
| Reminders is a page in the left nav | **Implemented** | `ui/app.ts` navItems `{ route: "reminders", render: renderReminders }` |

So the gaps below are **partial / polish / verification**, not absent features. Each lists what is
missing or partial, where, and whether it is a small or large fix.

## Gaps (partial or polish)

### 1. The Reminders UI has no automated test coverage — partial (verification)
- **Missing:** `src/dashboard/ui/reminders.ts` (add row, inline edit, done toggle, delete, the
  "Coming up (30 days)" side panel) has no tests. `build-report.md` states plainly that "the UI has
  no automated tests in the suite; only the server and the calculations do." The server reminders
  logic *is* covered by `tests/dashboard-reminders.test.ts`.
- **Where:** `src/dashboard/ui/reminders.ts`; suite under `tests/`.
- **Size:** medium (UI is DOM-builder code with no existing harness to render it headlessly).

### 2. Clicking a reminder/prepare calendar entry opens the page but does not select the item — partial
- **Partial:** `openSource` navigates to the Reminders page but passes no identifier, so the specific
  reminder is not scrolled to or highlighted. Assumption 48 ("opens the module that owns it … that is
  where you change it") is satisfied at the page level only.
- **Where:** `src/dashboard/ui/calendar.ts:29-30` (`openSource` → `context.navigate("reminders")`);
  the receiving page `src/dashboard/ui/reminders.ts` has no "focus this id" path.
- **Size:** small–medium (pass the `sourceId` through navigation and focus/scroll its row).

### 3. Personal dates are modelled as completable reminders, not a distinct "date" type — partial
- **Partial:** a "personal date" (e.g. a birthday) is just a `Reminder` with `category: "personal"`,
  so it carries a **Done** checkbox and, once ticked, drops out of the Overview panel and fades on the
  calendar (assumption 59). That is reasonable for a to-do but semantically odd for a recurring life
  date. The design phrase "personal dates appear … as reminders" is met literally; there is no
  separate non-completable date concept.
- **Where:** `src/dashboard/reminders.ts` (`Reminder.done`, `list` status filter); `ui/reminders.ts`
  (done checkbox).
- **Size:** small (if only to suppress/relabel "done" for personal) to medium (if a distinct type).

### 4. The Reminders page's side column re-fetches `/api/overview` — partial (coupling)
- **Partial:** the "Coming up (30 days)" side list calls `GET /api/overview` and reads
  `overview.reminders` (`ui/reminders.ts:52`). It reuses the Overview's panel data, which is fine
  functionally, but couples the Reminders page to the whole Overview response (and now re-reads budget
  etc. it does not use). There is no dedicated reminders-panel endpoint.
- **Where:** `src/dashboard/ui/reminders.ts:50-53`.
- **Size:** small (add/point at a focused endpoint, or compute from `/api/reminders`).

## Observation beyond the stated design (not a gap against it)

### No recurrence for annual personal dates (birthdays/anniversaries)
- The stated design does **not** mention recurrence, so this is **not** a gap against it — noted only
  because "personal dates" often implies yearly repeats. A reminder is a single `date`
  (`reminders.ts:10-20`); nothing expands it to recur, so a birthday added once appears once and then
  is in the past. If annual personal dates are wanted later, this is a **large** fix (recurrence field
  on the model, expansion in `timeline.ts`, and UI), and should be an explicit owner decision first.

## Verdict

The Reminders design as written is **implemented end-to-end on the server and the page**, and is
covered by server-side tests. Remaining work is: UI test coverage (#1), deep-linking a clicked entry
to its row (#2), the completable-vs-date semantics of personal dates (#3), and decoupling the page's
side list from `/api/overview` (#4). Recurrence is a separate, larger, design-level decision.
