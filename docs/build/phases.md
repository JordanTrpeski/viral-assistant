# Calendar v2 — phases

Decisions: `docs/design/calendar-v2.md` (source of truth). Branch: `feat/calendar-v2`.

Naming (phase 5b): the user sees **Deadline** (stored kind `task`) and **Event** (stored kind `reminder`).
Stored kinds are unchanged; only display names differ.

## 0 — Cleanup and brief
Branch, decisions file, parked code, app still runs.
**Done when:** the branch exists with the decisions file and phases file, self-development and chat are
parked (code kept), and the dashboard still runs with Finance, Groceries, Budget and Overview loading.

## 1 — Data model
Categories, subcategories, deadlines (task), events (reminder), all-day, time zones, trash, done log. No Google.
**Done when:** unit tests cover create, move, restore and delete.

## 2 — Google connection
Sign-in, one stored token, calendar list.
**Done when:** the user signs in and sees calendars.

## 3 — Read-only sync
Events from all calendars and holidays, sync button, sync tokens with full resync on expiry.
**Done when:** events show and the button reports what changed.

## 4 — Organise calendar and views
Organise calendar, Today strip, weekly and monthly views with dimmed subscribed events and the highlight
toggle.
**Done when:** screens match the decisions.

## 5 — Two-way sync (timed items, user's calendar)
Push, link table, colours, reminders.
**Done when:** on the "Viral test" calendar a round trip works both ways.

## 6 — Trash, conflicts and restore
**Done when:** deletes and restores work on both sides.

## 7 — Category and reminder UI
Defaults, overrides, move-before-delete.
**Done when:** each rule behaves as written.

## 8 — Migration and removal
Move old data from the backup, remove old Organise, merge the branch.
**Done when:** the backup restores cleanly and nothing is lost.
