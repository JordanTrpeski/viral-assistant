# Calendar v2 — decisions (source of truth)

This file is the source of truth for the calendar rebuild (branch `feat/calendar-v2`). All later phases
(see `docs/build/phases.md`) follow the decisions below. Where a phase would change a decision here, update
this file first.

## Organise (rebuilt from scratch on this branch)

The old Organise is **removed only after migration in phase 8**; until then it stays in place, parked.

- **Keep:** Calendar view (full view in Organise; read-only preview on the main dashboard), Reminders,
  Tasks, Today strip, weekly and monthly overviews, search, export.
- **Remove:** Inbox, Money, Notes and lists, Projects, Trackers, Auto-suggest and rules, and Weekly review
  as a separate page (the weekly overview replaces it).
- **Settings** live inside the Organise dashboard.

## Categories (dynamic, user-editable)

- **Defaults:** Study, Work, Admin, Home, Health, People, Personal. Each has subcategories with initial
  defaults the user will edit.
- Category is **optional** when adding an item. Items without one appear under **"No category (n)"** on the
  Organise dashboard. There is **no catch-all category**.
- **Renaming** a category changes nothing on Google.
- **Deleting** a category is blocked while it has items. The user must move them first, using a move dialog
  that picks category and subcategory.
- Changing an item's category **clears its subcategory** until one is chosen.
- Each category has a **colour for Google events**, taken from Google's event colour palette at runtime. The
  app owns that colour.

## Tasks

- **Fields:** due date, planned day, priority (low, normal, high), status (open or done), recurrence (weekly,
  monthly, yearly), done log, carry-over of unfinished tasks to today, snooze, and undo for a short time.
- **Recurring tasks stay in the app only** in version one (not pushed to Google as recurring series).
- **Deleting a recurring item** offers: this occurrence (no trash entry), this and all future, or the entire
  series.

## Reminders

- **Lead time in days.** Each category has a **default set** of reminders. An item inherits it, or overrides
  it. An **override replaces** the default — it does not add to it. A category can hold **more than one**
  reminder.
- **All-day items** have reminders at a fixed time of day (default **09:00**). **Timed items** use their own
  time.
- Persistent alerts are **out of scope**.

## Google Calendar

- The user's **own calendar is two-way**, for **timed items only**.
- **All other calendars are read-only.** Work calendars, subscribed calendars and national holidays are read
  in and shown in the week view and Today strip. They appear **dimmed**, labelled with the calendar name. The
  app **never writes** to them — enforced in code.
- A **highlight toggle per calendar** is display-only, stored in the app.
- **Sync:** one **"Sync now"** button, plus one sync on app start. **No background timer.**
- **Deletes and conflicts:** a **Deleted list holds items for 7 days**. It holds app deletions, Google
  deletions on your calendar, and the losing version of a conflict. **Restore** puts the item back and pushes
  it to Google if it was synced. Subscribed calendars are **hidden, not deleted**.
- **Conflicts:** the **newer edit wins**.
- **Time zone:** a small grey label on timed items only.
- **All-day items:** date only, shown at the top of the day, never timed reminders.

## Cut (not in any version now)

Google Tasks, location, email, time tracking, sharing, copying subscribed events, persistent alerts,
estimates, tags.

## Google auth

- **OAuth desktop client.** The client JSON lives in `.viral/` and is git-ignored. Store **one refresh
  token** and reuse it.
- **Known limit:** while the app is in Testing, tokens expire after **7 days**.
