# Dashboard v1 — design (source of truth)

This document is the authoritative design for the Viral dashboard v1 (Finance, Groceries, Calendar,
Overview, Reminders, and text Chat). Where the build made a choice the owner had not fixed, it is
marked **default, owner to confirm**; everything else is **owner-agreed**. If code and this document
disagree, this document wins and the code is a bug.

Scope note: Chat is **text only** in this phase; the model (Ollama) is **not** connected. The chat
command layer (actions, validation, confirm/undo) is built and tested behind a stub proposer.

## Budget and targets — owner-agreed

- The **Overview budget is read-only**. Budget targets are edited **only in Finance** (Finance >
  Budget); the Overview shows the figures and progress plus a plain "Open Finance" link.
- **Weekly and monthly targets are independent** — changing one never changes the other.
- **Weeks run Monday to Sunday and reset on the 1st.** A week that crosses a month boundary is **cut
  at the month end** (the cut week's target is the weekly target prorated by its number of days).
- **Fixed bills** (rent, phone, subscriptions) are **committed for the month** on their due date and
  are **never split into weeks**.
- **Flexible categories** count against both the weekly and the monthly target.

## Calendar — owner-agreed

- **Monday-first** month grid, including the greyed leading/trailing days of neighbouring months.
- **Fixed category colours** with a legend; legend entries **toggle** visibility (per-browser).
- Each day shows up to two entries, then **"+N more"** (hidden categories excluded from N).
- **Personal dates** appear on the date itself and, when they have a `prepare_by`, as a separate grey
  "Prepare: …" entry on the prepare-by date. Prepare-by shows on the calendar and on the Overview.

## Chat — owner-agreed

- **Text only** this phase; **voice comes later**.
- Chat uses the **same actions as the buttons** — it proposes one of a fixed action list and never
  invents new capabilities or categories.
- **Future dates are allowed everywhere.** Anything dated after today **passes** and is flagged
  "(future date)" in the preview. **Nothing is rejected for being in the future.**
- **Weekday names resolve to the most recent past occurrence** on or before today; the **"next"** and
  **"last"** prefixes are supported ("next monday" is strictly after today, "last friday" strictly
  before).

### Actions (the only choices a proposal may make)

`add_expense`, `add_income`, `edit_transaction`, `delete_transaction`, `set_budget_target`,
`get_balance`. Direction is fixed by the action (expense vs income), never guessed.

### Validation (plain code, no model)

- Proposal must name an allowed action with all required fields and no unknown fields; every failed
  check is returned (not just the first), each as one plain sentence naming the field and reason.
- **Category** is matched against existing categories for the action's group (expense → Fixed or
  Flexible; income → Income; budget target → Flexible; an edit stays in the same group). Exact name/id
  first, then a case-insensitive trimmed match; a miss is rejected with the list of valid names. A
  proposal **never creates a category**.
- **Dates before the year 2000 are rejected.** (Future dates are not — see above.)
- **Read-only** `get_balance` is answered directly in the reply, with no proposal and no confirm.

### Confirm / undo flow

- A valid, non-read-only proposal is stored **pending** in the thread with a short id and timestamp;
  `POST /api/chat/threads/:id/messages` returns a reply, a proposal (with preview), or validation
  errors, and **never writes Finance data**.
- `POST /api/chat/proposals/:id/confirm` is the **only** chat path that writes; it re-checks the data
  through Finance, applies the action once, and returns the saved entry plus an undo token.
- `POST /api/chat/proposals/:id/cancel` discards a pending proposal.
- `POST /api/chat/undo/:token` reverses the last chat write within the undo window.

## Defaults (default, owner to confirm)

- **Undo window: 10 seconds, single use, most recent chat write only.** — default, owner to confirm
- **Undo semantics:** an add is removed; an edit restores the previous values; a delete restores the
  same record with the same id; a budget-target change restores the previous target. — default, owner
  to confirm
- **Undo tokens are held in memory**; a restart ends any open undo window. — default, owner to confirm
- **Proposal expiry: 10 minutes** after creation (derived on read; nothing is deleted). — default,
  owner to confirm
- **Amount limit per chat entry: €5,000**, configurable via `dashboard.chatMaxAmountCents` (default
  500000 cents). — default, owner to confirm
- **Amounts must be JSON numbers**, not text (e.g. `12.5`, not `"12.50"`). — default, owner to confirm
- **"last"** means the most recent transaction added by a **confirmed chat proposal in this thread**,
  with **no fallback** to older entries; if it no longer exists the proposal is rejected. — default,
  owner to confirm
- **Chat-created transactions carry `source: "chat"`.** — default, owner to confirm

## Out of scope for this phase

Model-backed chat replies and voice; the Gym, Projects and Viral tasks modules (greyed out); any
connector other than Finance ↔ Groceries. The production proposer only ever returns the fixed reply
"Chat is not connected to a model yet." until a model is connected.
