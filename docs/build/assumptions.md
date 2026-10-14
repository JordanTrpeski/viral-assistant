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
