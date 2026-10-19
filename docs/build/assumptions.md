# Dashboard build — assumptions and decisions

Every entry is **assumed, revisit**. Each was decided without stopping to ask, as the build brief required.
Entries 1–6 come from the brief. The rest were decided during the build, grouped by milestone.

## From the brief

1. **Weekly and monthly targets are independent.** Changing one never changes the other. — assumed, revisit
2. **Editing a past transaction recalculates that month's totals live.** Totals are never cached; every summary is computed from the stored transactions on each request. — assumed, revisit
3. **Budget and Categories are tabs inside Finance, and also summarised on the Overview.** — assumed, revisit
4. **Templates show in a right-hand column on the Groceries shopping list view.** — assumed, revisit
5. **The − and + step is 10 EUR, set in config** (`dashboard.budgetStepCents: 1000` in `viral-dev.config.json`). — assumed, revisit
6. **The UI is a single plain HTML, CSS and TypeScript page served by a loopback-only daemon, with no external CDN and no new frameworks.** — assumed, revisit

## M1 — Data model

7. **There is no existing HTTP daemon on `main`.** The desktop daemon exists only on the unmerged `feat/m06-desktop-final` and `feat/m05-voice-clean` branches. This build therefore adds its own small loopback server, `viral-dev dashboard` (built on `node:http`, no new dependencies), instead of depending on unmerged work. — assumed, revisit
8. **Category kinds are Fixed, Flexible and Income.** The design says categories are Fixed or Flexible, but income also needs a category, because unknown categories are rejected. Income is a third kind. — assumed, revisit
9. **The transaction kind is derived from its category:** Fixed → `bill`, Flexible → `expense`, Income → `income`. A request may send `kind`, but it must match the category or it is rejected with 400. The `fixed` flag is stored and always equals "category is Fixed". — assumed, revisit
10. **Default categories are seeded on first run:** Rent, Phone, Subscriptions (Fixed); Groceries, Entertainment, Transport (Flexible); Salary (Income). Category ids are slugs of the name, so `groceries` is a stable id for grocery trips. — assumed, revisit
11. **Budget targets exist only for Flexible categories.** Fixed bills are committed, not targeted. A target of 0 means "no target". The − control stops at 0. — assumed, revisit
12. **Opening balance** (`settings.openingBalanceCents`) is the balance before the first recorded transaction. It is the one money value that may be zero or negative. It is edited on the Settings page. — assumed, revisit
13. **A category cannot change kind or be deleted while transactions use it** (400 with the count), so transaction kinds stay consistent. Renaming is always allowed. — assumed, revisit
14. **Unknown category ids inside a payload return 400 ("Unknown category"); an unknown id in the URL returns 404.** — assumed, revisit
15. **Unknown fields in a payload are rejected with 400**, so typos fail loudly instead of silently doing nothing. — assumed, revisit
16. **Dates are calendar dates (`YYYY-MM-DD`) in the person's local time zone.** "Today" is the server machine's local date. Date arithmetic uses UTC internally so daylight-saving changes never shift a day. — assumed, revisit
17. **Storage:** finance in `.viral/finance/finance.json`; groceries, reminders and dashboard data in `.viral/dashboard/*.json`. Writes go to a uniquely named temp file in the same directory, then `rename`. Writes are serialized per file. A failed write leaves both the file and the in-memory state unchanged. A corrupt file is reported as an error, never silently replaced with defaults. Both folders are added to `.gitignore`. — assumed, revisit
18. **A transaction dated today or earlier is "done"; a later one is "scheduled".** This is its timeline status. — assumed, revisit

## M2 — Finance

19. **Balance** = opening balance + income − (expenses + bills), counting only transactions dated today or earlier. — assumed, revisit
20. **"Income this month" and "Spent this month" count only transactions dated today or earlier.** Future-dated bills are commitments; they show in the month budget's "Committed bills", not as spent. — assumed, revisit
21. **Runway** = balance ÷ average daily spend (expenses + bills) over the last 90 days including today, in whole days, also shown as ≈ months (÷ 30.44). No spending in the window shows "—". A balance of zero or less gives 0 days. — assumed, revisit
22. **A week cut at the month edge gets a prorated weekly target:** round(weekly × days ÷ 7), to the cent. Example: a 7 000-cent weekly target on the one-day week of Sunday 1 November becomes 1 000 cents. — assumed, revisit
23. **Weekly and monthly budgets count only `expense` transactions in Flexible categories.** Bills (Fixed) are never split across weeks; they appear only in the month view as committed, with their due dates, whether or not the date has passed. — assumed, revisit
24. **Inline editing.** A row enters edit mode with Edit (or a double-click). Each field saves on change, with no confirmation. Done leaves edit mode. Delete removes the row immediately, with no confirmation, as the design requires. — assumed, revisit
25. **"+ Add transaction" opens an inline row at the top.** It is created as soon as it has a valid amount, so date, category and note should be set first. Later edits to that row save live. — assumed, revisit
26. **The top bar shows "Tokens today: n/a".** Viral's efficiency telemetry records no token counts, so `/api/status` returns `tokensToday: null` with an explanatory note, rather than inventing a number. — assumed, revisit
27. **Daemon status** comes from polling `GET /api/status` every 10 seconds: green "Daemon online" when it answers, red "Daemon offline" when it does not. — assumed, revisit
28. **Security of the loopback server.** It binds only to 127.0.0.1, ::1 or localhost; config refuses any other host. It also rejects non-loopback clients, and Host headers that are not loopback (403, a DNS-rebinding defence). Request bodies must be `application/json` (415 otherwise), which blocks cross-site form posts. Bodies are capped at 1 MB. Static serving is a fixed allow-list: `/`, `/styles.css` and `/assets/{ui,shared}/<name>.js`. — assumed, revisit
29. **The page and stylesheet are read from `src/dashboard/ui/`; browser modules come from the compiled `dist/src/dashboard/{ui,shared}/`.** The UI is split into several small TypeScript modules for readability; it is still one page with no framework and no CDN. Run `pnpm run build` before starting the dashboard. — assumed, revisit
30. **Dark theme**, because the design specified no theme and dark suits the fixed category colours. — assumed, revisit
31. **The route set** is listed in `docs/build/build-report.md`. Creation returns 201, deletion 204, an unknown route 404, and a wrong method 405. — assumed, revisit
32. **New config.** A `dashboard` section was added to `viral-dev.config.json` with `host`, `port` (4174) and `budgetStepCents` (1000). This is the only change to that file, and the brief allows it. — assumed, revisit

## M3 — Groceries

33. **Groceries reaches Finance only through a small `FinancePort` connector** (create, update and delete the trip's expense), never by reading or writing `finance.json`, following the repository's connector-first rule. — assumed, revisit
34. **Completing a trip** takes the ticked items and needs a unit price for each. It writes **one** Finance expense in the Groceries category, for Σ quantity × unit price in cents, with the note "Groceries trip — <store>" and `source: "groceries"`. It records each item's price in the price history and removes the bought items from the list; unticked items stay. — assumed, revisit
35. **If saving the trip fails after the expense was written, the expense is deleted again**, so Finance and Groceries never disagree. The trip is also refused if the list changed in between. — assumed, revisit
36. **The Groceries category is found by id `groceries`, or by a Flexible category named Groceries.** If neither exists, completing a trip returns 400 and asks you to create one. — assumed, revisit
37. **Editing a trip** (date, store, or item quantities and prices) updates its expense's amount, date and note, and regenerates that trip's price entries. **Deleting a trip** deletes its expense and its price entries. If the expense was already deleted in Finance, the trip is kept and marked "Expense deleted in Finance"; deleting a trip's expense in Finance does not delete the trip. — assumed, revisit
38. **Prices** are per unit, in cents, grouped per item case- and space-insensitively ("Bread" = "bread "). **Price watch** lists items whose latest price differs from the one before it, with the change in cents and percent (one decimal), biggest change first. Price entries can also be added, edited and deleted by hand. — assumed, revisit
39. **New shopping-list items default to the item's latest known price**, if there is one. The price can be cleared or changed. — assumed, revisit
40. **Template Start adds the template's items to the list, skipping any name already waiting there unbought** (case-insensitive), and says which were skipped. — assumed, revisit
41. **Quantities are whole numbers ≥ 1.** Each trip needs at least one item; to remove the last item, delete the trip. — assumed, revisit
42. **The browser client always sends a JSON body on POST, PATCH and PUT** (`{}` when there is nothing to send), because the server refuses writes without `application/json`. A headless-browser check found this bug on the template Start button before commit. — assumed, revisit

## M4 — Calendar

43. **The calendar shows whole Monday-first weeks**, including the greyed leading and trailing days of the neighbouring months, along with their entries. — assumed, revisit
44. **Order within a day** is Bills, Income, Gym, Viral, Personal, Spending, Reminder, then label A–Z. The first two are shown, followed by "+N more". Clicking "+N more" expands that day in place, and "Show less" collapses it. — assumed, revisit
45. **Hidden legend categories are removed from the cells before "+N more" is counted**, so N never includes hidden entries. The `/api/calendar?hidden=…` query does this on the server. — assumed, revisit
46. **The legend's hide and show choice is a per-viewer preference kept in browser `localStorage`.** It is not saved data and is not shared. The calendar works normally if storage is unavailable. — assumed, revisit
47. **Prepare-by entries** appear as separate grey Reminder entries ("Prepare: <label>") on the prepare-by date. Hiding "Reminder" in the legend hides them. *(Changed in M6:)* a prepare-by entry is done only when its reminder is done or the event date has passed. A prepare-by date that has passed before the event is **overdue**, not done, so it stays in the Reminders panel in red. — assumed, revisit
48. **Clicking a calendar entry opens the module that owns it**: transactions open Finance, reminders and prepare-by entries open Reminders. That is where you change it, as the design's "change it in its module" principle requires. — assumed, revisit
49. **Entries whose date is today or earlier are drawn slightly faded ("done")**; future entries are full colour. — assumed, revisit

## M5 — Overview

50. **Right column width** is 380px at 1600px and wider, and 320px below that. The calendar takes the rest. The right column scrolls by itself if its panels are taller than the screen, which can happen at 1280×800. — assumed, revisit
51. **Next 7 days covers today plus the six following days** and shows every timeline entry in that window (bills, income, spending, reminders, prepare-by), including today's already-done entries. Each row shows date, coloured label and amount, and clicking it opens the owning module. — assumed, revisit
52. **The Overview Reminders panel** shows open (not done) reminders and prepare-by entries that are overdue or due within the next 30 days, soonest first, at most eight. Overdue dates are red. "Open" links to the Reminders page. — assumed, revisit
53. **The Budget panel toggles between "This week" and "This month".** The toggle state is kept only while the page is open. The − and + target controls live in Finance only (Finance > Budget); the Overview budget is read-only and offers a plain "Open Finance" link instead of editing targets in place. — decided by owner
54. **The chat placeholder is an empty dashed box labelled "Chat, coming later"** that fills the remaining height of the right column. No chat or voice code was built. — assumed, revisit
55. **`/api/overview`** returns the right column's data (next seven days, reminders, budget) in one response. It uses the same timeline and budget functions as the calendar and Finance, so all views agree. — assumed, revisit

## M6 — Reminders

56. **The Reminders nav item is a working page** in this build. The brief listed Reminders next to the greyed-out items but also said "as a separate page", and the design says only Gym, Projects and Viral tasks are greyed out. The design is the source of truth. — assumed, revisit
57. **A reminder's category can be any of the seven calendar colour categories**, defaulting to Reminder (grey). This lets a gym session or a Viral task be a dated reminder before those modules exist. — assumed, revisit
58. **Prepare-by.** Personal reminders get `prepareBy` = date − 14 days unless the request sends a date, or `null` for none. Other categories default to none. `prepareBy` must be on or before the reminder date (400 otherwise). Moving the date moves a default prepare-by with it; a custom prepare-by stays where it is. Switching a reminder to Personal adds the default if it has none. — assumed, revisit
59. **Reminders have a done flag.** Ticking it saves immediately, takes the reminder and its prepare-by entry out of the Overview panel, and fades it on the calendar. It stays on the Reminders page under Done or All. — assumed, revisit
60. **Personal dates appear twice**: as a pink entry on the date itself and as a grey "Prepare:" entry on the prepare-by date. Both show on the calendar, in Next 7 days when in range, and in the Reminders panel. — assumed, revisit
61. **The Reminders page lists reminders with Open, Done and All filters**, ordered by date, with an inline add row and live inline editing. A side column shows the next 30 days of open reminders and prepare-by entries, the same data as the Overview panel. — assumed, revisit
62. **Storage:** `.viral/dashboard/reminders.json`, written with the same atomic store as everything else. — assumed, revisit

## Not built (out of scope by the brief)

63. Model-backed chat replies and voice (see the Chat section below: the text chat UI exists, but replies are a fixed placeholder), the Gym, Projects and Viral tasks modules (greyed out in the nav), and any connector other than Finance ↔ Groceries. — assumed, revisit

## Chat (text, UI only)

64. **Chat is UI and storage only.** There are threads (a permanent "Main" plus named threads that can be created, renamed and deleted), a message list, a composer and the routes under `/api/chat`. Ollama and every other model are not connected, and no model calls are made. — assumed, revisit
65. **Every reply is the fixed placeholder "Chat is not connected to a model yet."** It is stored as an ordinary `assistant` message, written in the same atomic write as the user's message, so the flow can be tested end to end. — assumed, revisit
66. **Retention is undecided; nothing is deleted automatically.** A thread and its messages stay in `.viral/dashboard/chat/<thread-id>.json` until the owner deletes the thread. The pane says "Kept until you delete it. Retention rule not decided yet." — assumed, revisit
67. **The expanded or normal state of the chat pane is stored per browser** (`localStorage`, key `viral.chat.expanded`). It is not shared, and it falls back to normal size if storage is unavailable. When expanded, the calendar and the other right-column panels are removed from the Overview and the chat fills it, up to 1100px wide. — assumed, revisit
68. **Details decided while building the chat:**
   - Thread names are trimmed and must be 1–40 characters; duplicate names are allowed. Message text is trimmed and must be 1–2000 characters.
   - Main is created on first use and cannot be renamed or deleted (400).
   - Thread ids are `main` or a UUID. Anything else is a 404 before any file access, so an id cannot point at another file.
   - Rename is by the ✎ button or by double-clicking a tab. Delete (✕) is immediate, with no confirmation, and returns you to Main.
   - The thread you are viewing and an unsent draft are kept only while the page is open.
   — assumed, revisit

## Chat commands (actions, validation, confirm flow; no model)

69. **The brief for this step was cut off** mid-sentence at "Undo of an edit restores the…". Undo was completed in the obvious way: an add is removed, an edit gets its previous values back, a delete gets the same record back (same id), and a budget target gets its previous value. Nothing after the cut-off was built. — assumed, revisit
70. **No model is connected.** The production proposer (`PlaceholderProposer`) never proposes anything and only replies "Chat is not connected to a model yet." Tests inject `StubProposer`, which returns whatever proposal the test sets. In the real app, proposals therefore cannot appear until a model is connected. — assumed, revisit
71. **The action list is the six actions in `src/dashboard/commands/actions.ts`, and nothing else is accepted.** `add_income` takes the same fields as `add_expense`; note and date are optional, and date defaults to today. `edit_transaction` must change at least one of amount, category, note or date. `get_balance` takes no fields. — assumed, revisit
72. **Category types per action:**
    - `add_expense` accepts Fixed categories (saved as a bill) and Flexible categories (saved as an expense).
    - `add_income` accepts only Income categories.
    - `set_budget_target` accepts only Flexible categories.
    - An edit's new category must stay in the same group: Income, or Fixed/Flexible.
    - Matching is the exact name or id first, then a case-insensitive, trimmed match. A proposal never creates a category; a miss is rejected with the list of valid names. — assumed, revisit
73. **Amounts.**
    - An amount must be a JSON number; strings like "12.50" are rejected.
    - It must be finite, greater than 0, and at least 1 cent after rounding half-up to cents. It must be at most `dashboard.chatMaxAmountCents`, a new config key defaulting to 500000 (€5,000).
    - A budget target set from chat must also be greater than 0.
    - **New config key** in `viral-dev.config.json`: `dashboard.chatMaxAmountCents`. — assumed, revisit
74. **Dates.**
    - Words: "today", "yesterday" and "tomorrow". A weekday name means its most recent occurrence on or before today. "last <weekday>" is strictly before today; "next <weekday>" is strictly after.
    - ISO `YYYY-MM-DD` is accepted. Years before 2000 are rejected.
    - **Future dates are allowed everywhere** (flexible expenses, income and bills alike). Anything dated after today passes validation and is flagged "(future date)" in the preview; nothing is rejected for being in the future. — decided by owner
75. **Target "last"** is the most recent transaction created by a confirmed chat proposal *in this thread*. It does not fall back to an older one: if that transaction no longer exists, the proposal is rejected. An undone add is removed from the thread's list, so "last" then means the one before it. — assumed, revisit
76. **get_balance is read-only and answered directly in the reply**, with no proposal and no confirm. — assumed, revisit
77. **Proposals.**
    - Each has an 8-hex-character id, a preview line, flags and a status, stored in the thread file.
    - A proposal expires 10 minutes after it is created; "expired" is derived from that time when the thread is read, nothing is deleted.
    - Confirming or cancelling a proposal that is expired, confirmed, cancelled or undone returns 400. An unknown or malformed id returns 404.
    - `POST …/messages` returns `outcome: "reply" | "proposal" | "invalid"` along with the stored messages. It writes only to the chat thread, never to Finance. — assumed, revisit
78. **Confirm re-checks the data through Finance.** If the target was deleted or the category removed in the meantime, it returns 400 "This proposal can no longer be applied: …" and the proposal stays pending. Confirm, cancel and undo run one at a time, so a proposal is applied at most once. If the thread cannot be saved after a write, the write is reversed. — assumed, revisit
79. **Undo.**
    - Tokens are held in memory only, so a restart ends the 10-second window. Each token works once.
    - Only the most recent chat write can be undone.
    - An undo is refused (400) if the entry no longer has the exact values the chat write left, for example because it was edited in Finance since. Comparing values rather than timestamps matters: a test caught that two edits within the same millisecond share a timestamp.
    - Undo of a delete puts back the original record, using the new `FinanceService.restoreTransaction`. — assumed, revisit
80. **Transactions created from chat have `source: "chat"`.** This is a new source value, next to manual and groceries. — assumed, revisit
81. **The UI change is the minimum needed to act on a proposal.** Proposal messages show Confirm and Cancel. A confirmed write shows Undo for its 10 seconds. Validation errors are listed in the reply. Confirm, cancel and undo routes return 200. — assumed, revisit

## Chat model connection (Ollama)

82. **The model is given only four things:** the user's message, today's date (ISO), the six actions with their field schemas, and the existing category names grouped by type (Fixed, Flexible, Income). No transaction data, balances, history, or other threads are sent to the model. — assumed, revisit
83. **Timeout is 30 seconds per call, from `dashboard.timeoutMs`.** One request, no streaming, no automatic retry. On timeout or an unreachable Ollama the proposer returns the reply "Chat could not reach the model right now." and logs the reason; it never throws into the chat route. Any other model failure (invalid JSON, an action outside the list, or action "none") falls back to the existing plain placeholder reply, so plain-message behaviour is unchanged. — assumed, revisit
84. **Reasoning blocks are stripped before parsing.** Qwen3 can wrap its answer in a `<think>…</think>` block (and sometimes ```json fences); both are removed, then the first `{…}` object is parsed. Structured output is requested only through a strict JSON-only system prompt — the shared loopback adapter in `src/local` exposes no `format` parameter, and this step reused that adapter rather than writing a second HTTP client or widening its contract. Ollama 0.40.6 (probed via `viral-dev local-status`) would support a `format` parameter; wiring it through the adapter is left for a later step. Validation remains the only guardrail on a proposal. — assumed, revisit
85. **`dashboard.proposerEnabled` (default true) selects the proposer.** True wires the model-backed `OllamaProposer`; false keeps the `PlaceholderProposer`, so no proposals appear. Model, timeout and this flag are the only new keys in the dashboard config section. — assumed, revisit

## Chat ambiguous words and clarification

86. **A short in-code map of ambiguous spending words to candidate categories** lives in `src/dashboard/commands/ambiguity.ts`: coffee → Entertainment/Groceries/Spending, dinner/lunch → Entertainment/Groceries, drinks → Entertainment/Spending, gift → Personal/Spending, snacks → Groceries/Entertainment. Candidate names are filtered against the live category list at request time; names that are not real categories are dropped. With the current defaults only Entertainment and Groceries exist, so Spending and Personal are always dropped — which leaves "gift" with no candidates, so it never asks. — assumed, revisit
87. **The question rule (code, not model):** the model proposer runs as normal first; then, if the message contains an ambiguous word AND no existing category name appears in it (case-insensitive, whole-word), and the proposal is a spending add with a positive amount, no proposal is created. Instead a question "Coffee, €2.50. Which category?" is returned with the surviving candidates and an implied "Other…" (any valid existing category). The amount, note and date come from the model proposal; only the category is withheld. If the message names a category, or the model returned no proposal, nothing extra happens. — assumed, revisit
88. **Answering is a separate step that writes nothing.** `POST /api/chat/clarifications/:id/answer` takes a category (a candidate or any valid existing category), runs it through the existing validation, and on success turns the clarification into a normal pending proposal that then goes through the usual confirm. An invalid category is rejected with the existing category error. — assumed, revisit
89. **Remember-once:** a successful answer saves the exact word → chosen category id in `.viral/dashboard/chat-rules.json` (atomic write, sibling of the chat thread folder). The same exact word then proposes directly with the remembered category and is not asked again. Only the exact word is remembered. A clarification expires after the same 10 minutes as a proposal (derived on read); an expired or already-answered clarification returns 400, and an unknown id returns 404. — assumed, revisit

## Chat arithmetic (relative amounts in code)

90. **Relative amounts are computed in code, not by the model**, in `src/dashboard/commands/arithmetic.ts`. The model computes them unreliably (it returned 80 ÷ 4 = 12.50) and validation cannot catch a valid-but-wrong amount, so where a message states an arithmetic pattern the code evaluates it in integer cents and decides everything itself. (Superseded detail: see assumption 96 — arithmetic now runs *before* the model and the model is not called for these messages, so there is no model amount to "replace".) — assumed, revisit
91. **Recognised patterns (case-insensitive):** "divide X by N", "X / N", "X divided by N", "half of X" / "half X", "double X" / "double of X", "N percent of Y", "N% of Y". "that" / "that amount" / "the last amount" / "it" stand in for X. Division and percent round half-up to the cent; the working string shows the rounded value (e.g. "10 ÷ 3 = 3.33"). — assumed, revisit
92. **The reference ("that"/"it") is the last concrete amount in the thread** — the most recent number the user typed, or a confirmed proposal's amount, walking newest to oldest. The model's own output is never used as the reference, and a prior message that is itself a relative phrase is skipped so one guess cannot seed another. If the pattern is present but no reference exists yet, the chat asks for the number and makes no proposal. — assumed, revisit
93. **The code decides the action for a value, not the model** (replaces the earlier "override and logging" note). Because arithmetic runs before the model (assumption 96), there is no model amount to override or log. The code picks the action from the message: a Flexible category plus the word "target"/"budget" and a period → `set_budget_target`; a named spending/income category without a target word → `add_expense`/`add_income`; neither → the which-target question (assumption 97). — assumed, revisit
94. **"split X between N" is deliberately not calculated.** It returns a question, "Do you want your share of €X, or the total for everyone?", and makes no proposal — dividing silently would guess the user's intent. — assumed, revisit
95. **A value from arithmetic appends its working to the preview in brackets,** e.g. "Set Groceries weekly target to €20.00 (now €0.00) (80 ÷ 4 = 20)". Previews for non-arithmetic values are unchanged. — assumed, revisit

## Chat arithmetic runs before the model

96. **Arithmetic is evaluated in code before the model is called, and the model is not called for an arithmetic message.** The live model returns `{"action":"none"}` for a bare phrase like "divide that by 4", which previously lost the arithmetic entirely; running the patterns first in `ChatService.postMessage` fixes that. Non-arithmetic messages still go to the model exactly as before. — assumed, revisit
97. **A computed amount with no named target asks which target, rather than guessing.** The reply is the question "€X for which target?" with buttons "Groceries weekly target", "Groceries monthly target" and "Other…". "Other…" accepts any valid existing Flexible category and either period ("week"/"month"), typed as text and checked by the existing validation (so an invalid category or period returns the existing error). Answering it (`POST /api/chat/target-questions/:id/answer`) creates a normal pending `set_budget_target` proposal that goes through the usual confirm; the answer writes nothing. These questions expire after the same 10 minutes as proposals; an expired or unknown answer returns 400 or 404 like the existing routes. — assumed, revisit
98. **The default button is the target changed most recently in this thread, marked "(last changed)".** "Most recently changed" is read from the thread's confirmed `set_budget_target` proposals (newest `resolvedAt`). If it matches one of the two shown Groceries buttons, that button is the default; if no target has been changed in the thread, no default is marked. — assumed, revisit
99. **The bare-phrase rule applies to all four kinds** — "divide that by 4", "half of that", "double it", "10% of 250" — which all ask which target when no target is named. A named spending category keeps the expense behaviour ("half of 60 on groceries" still adds €30), and "split 60 between 3" keeps its share-or-total question. — assumed, revisit

## Organise v1 (`docs/design/organise-v1.md`)

### Step 1 — shared item model and store

100. **API and storage field names are snake_case** (`prepare_by`, `project_id`, `done_at`, …), exactly as the spec writes them, even though the older dashboard modules use camelCase. — assumed, revisit
101. **Every item stores every field of the shared model.** Fields that do not apply to its type are `null` (for example `priority` on a reminder). Sending a type-only field with a value for another type is rejected with 400. — assumed, revisit
102. **A note's title is optional.** Without one, the first line of its text (up to 200 characters) becomes the title, so the model rule "title 1 to 200" still holds. A note with neither title nor text returns 400. — assumed, revisit
103. **A project's name is its `title`**, limited to 1–100 characters instead of 200, and its description is its `notes`. A project cannot itself belong to a project. — assumed, revisit
104. **An item's type cannot change by editing (400).** Only inbox sort changes the type, as the spec describes. — assumed, revisit
105. **Defaults:**
    - Tasks: priority `normal`, status `open`.
    - Reminders: category `Other`, recurrence `none`, status `open`.
    - Projects: status `active`.
    - List items: the first status of their list.
    - `prepare_by` needs a `date` and must be on or before it; the same day is allowed. — assumed, revisit
106. **`done_at` is set when an item's status becomes its done status**: a task's or reminder's `done`, a project's `done`, or a list's last status. It is cleared when the item is reopened. Editing other fields of a done item keeps its original `done_at`. — assumed, revisit
107. **Deleting an item removes its id from every other item's `links`.** Deletion rules for projects and lists are set in their steps. — assumed, revisit
108. **`GET /api/organise/meta`** (not in the spec) returns the model's vocabularies (types, statuses, categories, recurrences, priorities). The browser UI uses it so it never duplicates them. — assumed, revisit
109. **Static serving was extended by one folder**, `/assets/ui/organise/<name>.js`, because the spec puts the UI under `src/dashboard/ui/organise/`. File names keep the same strict pattern. — assumed, revisit
110. **Navigation.** The Organise nav group (Overview, Tasks, Reminders, Notes and lists, Projects, Trackers) sits after Groceries. Gym and Viral tasks stay greyed out, and Settings stays pinned at the bottom. Organise pages without a UI yet appear greyed out until their step. The old greyed-out top-level "Projects" item is replaced by Organise > Projects. An item opens in the detail panel through `?item=<id>` in the address hash, so any page can open any item. — assumed, revisit

### Step 2 — inbox

111. **`GET /api/organise/inbox`** (not in the spec's route list, which only has POST) returns `{ count, items }`. The nav badge and the inbox panel use it. — assumed, revisit
112. **Sort forms use the API field names:** `date` is the task's due date, `project_id` is the project and `list_id` is the list. A note's form takes `text` (its body) and one optional `link`, as the spec lists. Fields that are not on the chosen target's form are rejected (400). The item keeps its id, `created_at`, its existing notes and links, and its title. Task and reminder forms may replace the title; note and list-item forms keep the captured text as the title. — assumed, revisit
113. **Sorting an item that is not in the inbox returns 400.** A failed sort changes nothing. — assumed, revisit
114. **The reminder sort form opens with today's date pre-filled.** A reminder needs a date, and the inbox never forces a decision before Sort is pressed. — assumed, revisit
115. **`GET /api/organise/lists` (read-only) arrives in this step** so the list-item sort target can offer lists. Creating and editing lists comes in step 5. — assumed, revisit

### Step 3 — tasks

116. **"Open" in the task groups means not done**, so `in_progress` tasks appear in Today, This week and Later alongside `open` ones. — assumed, revisit
117. **Order within a group:** due date (undated last), then priority (high, normal, low), then title. Done is ordered newest `done_at` first. — assumed, revisit
118. **Ticking every checklist entry does not complete the task**; completing is always an explicit step. Checklist edits send the whole list. Entries keep their ids, and new entries get one from the server. — assumed, revisit
119. **`GET /api/organise/tasks`** (not in the spec's route list) returns the four groups, accepting the same filters as `GET /api/organise/items`. The filters are `project_id`, `status`, and `from`/`to` (inclusive, on the item's date). A date range excludes undated items, and `from` after `to` returns 400. — assumed, revisit
120. **Module registry.** `src/dashboard/organise/modules/` holds one file per module, exporting `type`, `label`, `fields`, `statuses` and `actions` (`{ name, description, fieldSchema }`). The registry lists them, and `/api/organise/meta` exposes them under `modules`. Each step adds its own module. The actions are declarations only; nothing calls them. — assumed, revisit

### Step 4 — reminders

121. **Recurrence (the spec's own default, recorded as asked).** Completing a yearly or custom reminder marks that occurrence done and keeps it in Done. It then creates the next occurrence: same title, category, project, recurrence, interval, notes and links; date advanced (yearly: same month-day next year; custom: `interval_days` later); `prepare_by` kept the same number of days ahead; status open. Reopening a done occurrence does not remove the next one, and completing it again does not create a duplicate. — assumed, revisit
122. **29 February:** a yearly series started on 29 February falls on 28 February in non-leap years and returns to the 29th in leap years. To make this work, yearly reminders carry one internal field, `recurrence_anchor` ("MM-DD"). It is set by the server, cannot be set through the API, and is null for every other item. This is the only addition to the shared item model. — assumed, revisit
123. **prepare_by.**
    - A new Personal reminder (created or sorted from the inbox) without `prepare_by` gets 14 days before its date. Other categories get none.
    - **`prepare_days` (0 to 365) is accepted alongside `prepare_by`**, as "zero means none": 0 clears it, and n sets it n days before the date. Sending both returns 400.
    - Moving the date moves a 14-day default with it; a custom `prepare_by` stays where it is.
    - Switching a reminder to Personal adds the default if it has none. — assumed, revisit
124. **Calendar colours for Organise reminders:** Personal is pink (Personal), Bill is amber (Bills), and Study, Work, Health and Other are grey (Reminder). They enter the existing timeline as reminder entries with an optional `origin: "organise"`. That puts them on the calendar, in Next 7 days and in the dashboard Overview's Reminders panel, along with their grey "Prepare:" entries, without changing that code. Clicking one opens it under Organise > Reminders. — assumed, revisit
125. **The earlier dashboard Reminders page** (M6, `.viral/dashboard/reminders.json`) is neither deleted nor migrated. Its entry leaves the nav in favour of Organise > Reminders, but the page is still reachable at `#/reminders`, its reminders still show on the calendar, and clicking one still opens it. Merging the two stores is left for a later decision. — assumed, revisit
126. **`GET /api/organise/reminders`** (not in the spec's route list) returns Overdue, Upcoming and Done groups, with the same filters as items. — assumed, revisit
