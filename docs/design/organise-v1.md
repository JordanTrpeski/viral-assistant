# Organise, design v1

Status: agreed design. Build on feat/organise-v1.

## Purpose
Capture anything in one second, sort it later, see what is due, track ongoing goals, and review the last 7 days without digging.

## Principles
- One item model for everything in Organise.
- Live edits. Changes save immediately. No confirmation steps.
- Capture first, sort later. The inbox never forces a decision.
- Model-ready, not model-connected. Every module declares its actions the same way the chat command layer does (name, one-line description, field schema). No model is called in this build.
- Completing something moves it to Done. It is never deleted by completing it.

## Left nav
Organise (group): Overview, Tasks, Reminders, Notes and lists, Projects, Trackers.
Greyed out, not functional: Gym, Viral tasks.
Settings pinned at the bottom.

## Shared item model
Fields on every item:
- id
- type: task | reminder | note | list_item | project | inbox
- title (1 to 200 characters)
- date (optional, ISO YYYY-MM-DD)
- prepare_by (optional, ISO date, must be on or before date when both are set)
- recurrence (reminders only): none | yearly | custom (custom needs interval_days, 1 to 365)
- category (reminders only): Personal | Bill | Study | Work | Health | Other
- project_id (optional, must exist)
- status (see below)
- priority (tasks only): low | normal | high, default normal
- notes (text, up to 5000 characters)
- links (array of item ids that exist)
- list_id (list_items only, must exist)
- checklist (tasks only): array of { id, text (1 to 200), done }
- created_at, updated_at, done_at (set when status becomes done, cleared when reopened)

Allowed statuses by type:
- task: open | in_progress | done
- reminder: open | done
- list_item: depends on its list (see Notes and lists)
- project: active | paused | done
- note: none (notes have no status)
- inbox: none (inbox items are unsorted)

Storage: .viral/dashboard/organise/items.json (all items except tracker entries), lists.json, trackers.json (trackers and their entries), rules.json (suggestion rules and counts). Each file written atomically.

## Inbox (top of the Organise overview)
- One input. Enter adds an inbox item with the typed text as its title. Nothing else is asked.
- Unsorted count shows as a badge on the Organise nav item.
- Sort action on an inbox item: choose a target type (task, reminder, note, list item), fill the sort form, save. The item keeps its id and its type changes. Delete is also available.
- Sort form fields:
  - task: title, due date, priority, project, checklist
  - reminder: title, date, category, project, recurrence, prepare_by, notes
  - note: text, project, optional date, optional link
  - list item: list, status, notes
- The inbox shows auto-suggest chips (see Auto-suggest).

## Auto-suggest
- Runs on inbox items only, when the inbox is shown. Plain code. No model.
- Signal 1, date: text contains an ISO date, "d Mon" or "Mon d", a weekday name, "today", "tomorrow", or "on the Nth". Suggests a reminder.
- Signal 2, verb: the first word is in the editable verb list. Default list: call, email, buy, read, revise, finish, book, pay, send, renew, write, check, fix, clean, cook, practice, study, submit, prepare, plan. Suggests a task.
- If both signals match, suggest a reminder and offer a task as the second option.
- Each suggestion is a chip with Accept and Dismiss. Nothing is applied without Accept.
- Accept opens the sort form pre-filled with the suggested type. Accept counts are recorded.
- Dismiss counts are recorded per pattern. After three dismissals in a row of the same pattern, that pattern is muted. Muting is per pattern, not per text. A muted pattern is listed in Settings with an Unmute button.
- Settings for suggestions: edit the verb list, turn each date pattern on or off, see and unmute muted patterns.

## Tasks
- Fields: title, due date, status (open, in progress, done), priority, project, checklist.
- Checklist: items inside the task, each with done state. Subtasks are NOT separate items.
- Main list groups:
  - Today: open, due today or overdue (overdue flagged)
  - This week: open, due in the next 6 days after today
  - Later: open, no date or due later
  - Done: status done, newest done_at first
- Completing a task sets status done and done_at, and moves it to Done. It is not deleted. Reopen is available from Done.
- Filters: project, status, due date range.

## Reminders
- Fields: title, date (required), category, project, recurrence, prepare_by, notes.
- Personal category with recurrence yearly covers birthdays and anniversaries.
- prepare_by defaults to 14 days before the date for the Personal category, and to none for others. It can be edited per reminder. Zero means none.
- Recurrence: completing a yearly or custom reminder marks that occurrence done in Done and creates the next occurrence, with the same fields and the date advanced. Record this as a default.
- Shown on the calendar on their date, with a grey "Prepare:" entry on prepare_by, and in Next 7 days.
- Overdue reminders (open, date before today) are flagged.
- Completing a reminder moves it to Done. It is not deleted.

## Notes and lists
- Notes: optional title, body text, optional date, and links to any items (project, task, reminder).
- Lists: a name and a set of allowed statuses. Default statuses: to do, doing, done. A list can be created with a preset such as books: to read, reading, finished. A preset is only a set of status names.
- Each list row is a list_item with title, status from its list, notes, and optional links.
- Status changes are live.
- A list_item that becomes done (its list's last status) sets done_at.

## Projects
- Fields: name (1 to 100), description, status: active | paused | done.
- Project page shows sections, each with its open items first: Tasks, Reminders, Notes, Trackers, Lists.
- Tasks and reminders can be given a project at creation or edit.

## Trackers
- Fields: name, unit (text), target (number, optional), period: weekly | monthly | yearly, project (optional).
- Entries: date, value (number, 0 or more), optional note. Entries are stored separately from the tracker.
- Period boundaries: weekly is Monday to Sunday, monthly is the calendar month, yearly is the calendar year.
- Progress: sum of entries in the current period, against target, as a value, a percentage and what remains.
- No target: show the total only.
- History: totals for the last 8 periods.
- Entries can be edited and deleted live.

## Weekly review
- An on-demand page under Organise. Open it whenever you like.
- Window: the last 7 days ending today, inclusive. Rolling, not a calendar week.
- Done: tasks whose done_at falls in the window; list items that became done in the window; tracker entries dated in the window.
- Slipped: open tasks due in the window whose due date is before today; open reminders dated in the window.
- Trackers: each tracker's total in the window against its target scaled to 7 days. Weekly target is used as is. Monthly target times 7 / 30.4375. Yearly target times 7 / 365.25. Show "x of y (7-day equivalent)".
- Plain data only. No model.

## Search and filters
- Search on the Organise overview matches title, notes, checklist text and project name. Results are grouped by type.
- Each subpanel has filters for project, status, and date range.

## Today strip
- Top of the Organise overview, under the inbox.
- Shows: tasks due today or overdue and still open; reminders dated today or overdue and still open; reminders whose prepare_by is today or earlier and that are still open.

## Overview
- Top: inbox input, unsorted badge, Today strip, search.
- Then panels: Tasks (open count, due this week), Reminders (next 30 days, including prepare entries), Notes and lists (counts), Trackers (progress this period), Weekly review (link).

## Ask Viral slot
- A disabled box in the detail panel reading "Ask Viral (connect a model later)". Not wired.
- Future contract, documented only: a model would receive only the selected item's fields, and could only call named actions from the module registry or named queries. It never reads the store.

## Module registry
- Each subpanel is a module in src/dashboard/organise/modules/. Each module exports: type, label, fields, statuses, and an actions list of { name, description, fieldSchema }.
- A registry file lists the modules. Adding a module must not require editing the Overview.

## Routes (loopback, JSON, same conventions as the dashboard)
- GET and POST /api/organise/items
- GET, PATCH and DELETE /api/organise/items/:id
- POST /api/organise/inbox
- POST /api/organise/inbox/:id/sort
- GET /api/organise/today
- GET /api/organise/review?end=YYYY-MM-DD (default today)
- GET and POST /api/organise/trackers; PATCH and DELETE /api/organise/trackers/:id
- GET and POST /api/organise/trackers/:id/entries; PATCH and DELETE /api/organise/trackers/:id/entries/:entryId
- GET and POST /api/organise/lists; PATCH and DELETE /api/organise/lists/:id
- GET /api/organise/search?q=
- GET and PATCH /api/organise/rules
- POST /api/organise/suggest/:id/accept, /dismiss, /unmute
- GET /api/organise/export.csv (same CSV style as Finance: header row, quoted fields, UTF-8 BOM)

## Not in this design
- Subtasks as separate items.
- Analysis across long history.
- Remote or desktop control.
- Job applications.
- Recurrence beyond none, yearly and custom.
- Mobile.

## Build steps and acceptance

Step 1: shared item model and store.
- Routes for items: create, read, update, delete.
- Validation per the model: title length, type enum, status allowed for the type, date and prepare_by order, project and link ids exist.
- Tests: create, read, edit, delete, every validation failure, unknown id, atomic write, status rules per type.

Step 2: inbox.
- Add from text, list the inbox, sort to task, reminder, note or list item, delete, unsorted count.
- Sorting keeps the id and changes the type.
- Tests: each sort target, sort form validation, delete, count.

Step 3: tasks.
- Checklist with done state and n of m progress. Priority. Grouping into Today, This week, Later, Done. Complete sets done_at and moves to Done. Reopen.
- Tests: grouping boundaries (today, day 6, day 7), overdue flag, complete and reopen, checklist changes, filters.

Step 4: reminders.
- Category, recurrence, prepare_by with the Personal default of 14 days, completing a recurring occurrence creates the next one.
- Calendar and Next 7 days integration through the existing timeline code, including "Prepare:" entries.
- Tests: recurrence next date for yearly and custom, leap day handling for yearly, prepare_by default and override, overdue flag, calendar entries.

Step 5: notes and lists.
- Notes with links. Lists with statuses and presets. List rows with status and done_at.
- Tests: preset statuses, status change, links to existing items only.

Step 6: projects.
- Projects with status. Project page sections. Project on tasks and reminders.
- Tests: project page contents, open items first, project deletion rules (refuse while in use, or unlink; record which in assumptions).

Step 7: trackers.
- Tracker with period and target. Entries. Progress for the current period. History of 8 periods.
- Tests: week boundaries Monday to Sunday, month and year boundaries, no-target case, history count, entry edit and delete.

Step 8: weekly review.
- Rolling 7-day window. Done, Slipped, Trackers with scaled targets.
- Tests with a fixed date: window edges, a task finished on the first day of the window, a task finished the day before, a monthly tracker scaled to 7 days.

Step 9: auto-suggest and rules.
- Date and verb signals, chips, accept and dismiss, counts, muting after three consecutive dismissals per pattern, Settings for verbs and mutes.
- Tests: each signal alone, both signals, no signal, muting after three dismissals, unmute, accept does not auto-apply.

Step 10: search, filters, Today strip, export, Overview panels.
- Tests: search across fields, filter combinations, Today strip contents, export escaping and header, Overview counts.

UI: build the UI for each step in the same step's commit, in plain TypeScript modules under src/dashboard/ui/organise/. Check that each page renders at 1920 and 1280 wide if a headless browser is available. If it is not, write "UI not browser-checked" for that step in the report.

Verification at each step: remove dist, pnpm install, pnpm run typecheck, pnpm run lint, pnpm run test. All must pass before the step's commit.
