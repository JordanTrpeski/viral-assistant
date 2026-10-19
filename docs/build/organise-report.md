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
