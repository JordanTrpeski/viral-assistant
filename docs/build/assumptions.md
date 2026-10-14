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
47. **Prepare-by entries** appear as separate grey Reminder entries ("Prepare: <label>") on the prepare-by date. Hiding "Reminder" in the legend hides them. They are "done" once their date has passed. — assumed, revisit
48. **Clicking a calendar entry opens the module that owns it**: transactions open Finance, reminders and prepare-by entries open Reminders. That is where you change it, as the design's "change it in its module" principle requires. — assumed, revisit
49. **Entries whose date is today or earlier are drawn slightly faded ("done")**; future entries are full colour. — assumed, revisit
