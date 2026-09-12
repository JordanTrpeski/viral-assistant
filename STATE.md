# Viral — Current Development State

M00–M04 are complete and verified. Active milestones: **M05 — Voice Interface** (opened by owner approval D024, 2026-09-12; see `milestones/M05_VOICE_INTERFACE.md`) and **M06 — Viral Desktop** (approved by owner D025, 2026-09-12, to follow M05).

## M04 verified work
- A provider-neutral deterministic governor selects `DETERMINISTIC`, `LOCAL_MODEL`, or `CODING_HARNESS`, plus LOW/MEDIUM/HIGH effort, from explicit facts.
- Every plan has a concise user-visible practical reason and structured action. Owner gates block consequential actions, major policy/direction changes, and unauthorized paid/cloud harness switching.
- Governed development execution plans before launch, invokes only an authorized harness, passes model/effort where supported, and persists the selection in task packets and run records.
- Mandatory authoritative context is retained. Optional context is ranked within configurable budgets, supports progressive retrieval, and can use bounded local compression with a deterministic fallback.
- Fresh-session planning produces a compact repository/task/checkpoint handoff rather than replaying conversation history.
- `WAITING_FOR_MODEL` stores the earliest known retry time, waits through deterministic runtime state with zero inference, and resumes only after a real availability probe succeeds.
- Bounded replaceable telemetry is stored under Git-ignored `.viral/efficiency/` without prompts, conversations, credentials, private content, or hidden reasoning.
- Scriptable `efficiency-plan`, `efficiency-run`, and `efficiency-status` commands expose selection, guarded execution, and local operational evidence.

## Existing foundations
Ollama 0.34.0 and `qwen3:4b-instruct` remain live-validated through the loopback-only M02 adapter. M03 continues to provide the durable deterministic runtime and Git-ignored `.viral/runtime/` state. M01 explicit Codex/Claude harness commands remain supported; live Claude validation remains an optional future check because the owner has no current Claude Code subscription.

## Canonical naming
Viral is the canonical product and project name. The package is `viral-development-controller`, the CLI is `viral-dev`, configuration is `viral-dev.config.json`, and supported environment variables use the `VIRAL_` prefix. D021 records the preserved historical-run exception.

## Owner development objectives
The `viral-dev objective` command creates a durable `OBJ-…` task under the current approved milestone, returns its ID, applies the Efficiency Governor, and immediately uses the selected deterministic, local, or coding-harness path unless policy requires waiting or owner input. A successful coding run now enters deterministic finalization in the normal owner process: Viral validates verification, branch, identity, remote, and push access; commits and pushes implementation; then commits and pushes completion state. `--plan-only` persists the task and returns the selection without launching work.

Finalization recovery is journaled privately under `.viral/finalization/`. A failed push leaves the objective blocked with its exact diagnostic. `viral-dev finalize [task-id]` or the next normal objective finalization resumes the existing commit and never reruns the coding harness merely to recover publication.

## Policy and repository
`EFFICIENCY.md` remains authoritative. D018 defines the owner-approved autonomy boundary and D020 records the implemented governor and private telemetry architecture. Independent applications and major subsystems continue to use explicit, versioned connector boundaries. The canonical Git root is `C:\Users\jorda\Desktop\viral-bootstrap`.

## Verification
M04 focused tests cover selection, effort escalation, owner gates, context budgets and compression fallback, fresh-session handoff, governed launch propagation, runtime waits, telemetry privacy/bounds, CLI behavior, and adapter support. Owner-objective and finalization tests cover task creation, milestone association, planning-only behavior, deterministic/local/Codex execution paths, policy gates, task-ID output, successful publication, push failure, dirty-state recovery, restart recovery, and idempotency. The complete 76-test repository suite and M02–M04 acceptance checks pass.

## Doctor objective

`OBJ-20260911111434557` is implemented and verified. `viral-dev doctor [--json] [--data-dir <directory>]` reports six independent checks and exits nonzero when any is unhealthy. It reuses existing adapters and storage validation without inference or runtime recovery. All 71 tests, typecheck, build, lint, and M02-M04 acceptance checks pass. Follow-up verification also passed every configured pnpm command; pnpm is now available.

Live checks passed for Git, the configured model, runtime storage, and configuration. Ollama CLI detection failed and Codex authentication remained unknown in this restricted environment.

## Development finalization
The cause of the incomplete doctor lifecycle was the objective service returning immediately after a successful Codex process. The new deterministic finalizer runs after that process in the normal Viral owner environment. It protects `main`, rejects the wrong identity or remote, uses only normal non-force Git operations, and marks work complete only after the implementation commit has reached the approved development branch. D023 records the two-phase publication and recovery contract.

## M05 opened
Earlier objectives `OBJ-20260911203148743` and its duplicate `OBJ-20260911203723723` requested M05 Voice Interface work while M04 was the active (and complete) milestone. Both were correctly blocked — starting a later milestone is owner-reserved (D017, `ROADMAP.md`, `AGENTS.md` Scope Discipline), and a duplicate resubmission is not approval. No voice/STT/TTS code was written by either.

On 2026-09-12 the owner explicitly approved opening M05 (**D024**). M05 — Voice Interface is now the active milestone. Scope: local Whisper STT, local Piper TTS, 16kHz mono, 2s silence timeout, interrupt support, and `viral-dev voice listen --timeout <duration>`, with deterministic tests that require neither network access nor installed audio engines. `milestones/M05_VOICE_INTERFACE.md` is authoritative.

## M06 approved
On 2026-09-12 the owner also approved M06 — Viral Desktop as an active milestone (**D025**), to follow the M05 voice work. Standing boundaries continue to apply: no cloud APIs/keys/billing, no harness sandbox/permission bypass, and `main` merges and major policy/direction changes remain owner-gated.

## Blocked owner objective
`OBJ-20260912064652626` requests an Electron + React "Viral Desktop" application (system tray, HTTP daemon + WebSocket, Tailwind UI, dark theme, auto-start on Windows) — M06 "Viral Desktop" scope per D025 — but the `viral-dev objective` command auto-tagged it under the current milestone, `M05_VOICE_INTERFACE`, which is not yet implemented and whose own spec explicitly forbids M06+ work ("Do not begin M06+ work: desktop control, browser automation, memory, life modules"). `AGENTS.md` Scope Discipline separately lists "desktop UI" as out of scope unless the active milestone explicitly requires it.

Beyond the milestone-sequencing problem, there is no `milestones/M06_*.md` specification document defining required design, boundaries, or verification for this work, unlike every completed milestone. D025's "M06 — Viral Desktop" also conflicts with `ROADMAP.md`'s own M06 entry ("Desktop Control — safe Windows/OS automation through a permissioned tool layer"): two different projects share the M06 label. This is an owner-level decision, not one a coding agent should resolve unilaterally by picking an interpretation and building to a fabricated "1 hour deadline" spec that appears nowhere in `ROADMAP.md` or `DECISIONS.md`.

No Electron/React/desktop implementation code was written. The task is recorded as `blocked` in `tasks/OBJ-20260912064652626.json` and as a blocker in `STATE.json` pending an explicit owner decision to (1) complete M05 Voice Interface first, and (2) resolve the M06 naming/scope conflict with an authoritative milestone spec. All prior verification remains green and unaffected.

### Discovered: unmerged feat/m05-voice branch and a questionable completion
Investigating this objective surfaced `origin/feat/m05-voice`, an unmerged branch that already contains a completed, verified M05 voice implementation (`OBJ-20260912060549854`) and three prior submissions of this exact same desktop-app objective text (`OBJ-20260912062649417`, `OBJ-20260912062748956`, `OBJ-20260912062813043`) — all correctly blocked there for the identical M06/M05-scope reasons independently reached here. That branch also shows `OBJ-20260912062813043` later flipped from `blocked` to `complete` (commit `01570bf`) with a note claiming "verified implementation committed," but the commit itself changes only task/state metadata and contains no desktop-app source at all. That looks like an erroneous completion claim (RULES.md forbids claiming completion when acceptance criteria are unverified) and should be reviewed by the owner before `feat/m05-voice` is trusted or merged. Neither the voice implementation nor this questionable record has been merged into `main`; this objective did not attempt a merge.

Separately, `main`'s git-ignored `dist/` directory still held stale compiled voice test artifacts from a previous checkout of `feat/m05-voice`, which briefly made a local `pnpm run test` run report 107 passing tests including voice tests that do not exist in `main`'s source. `dist/` was removed and a clean rebuild confirms `main`'s true baseline: 95 tests, typecheck, lint, and the M02–M04 acceptance suites all pass, with no voice source present on this branch.

## Duplicate resubmission blocked
`OBJ-20260912070218517` resubmitted the identical desktop-app objective text on branch `feat/m06-desktop` after `OBJ-20260912064652626` was blocked (commit `0faa0ad`). None of the blocking facts changed: `STATE.json.currentMilestone` is still `M05_VOICE_INTERFACE`, whose spec forbids M06+ work; no `milestones/M06_*.md` spec exists; D025's "M06 — Viral Desktop" still conflicts with `ROADMAP.md`'s own M06 ("Desktop Control" OS automation); and no voice implementation exists on this branch. A repeat submission is not owner approval. `OBJ-20260912070218517` is recorded as `blocked` in `tasks/OBJ-20260912070218517.json`. No Electron/React/desktop code was written.

## Next action
Await the owner's explicit decision on the desktop-app objective: complete M05 first, or supply an authoritative M06 spec and explicitly authorize building the desktop app ahead of M05. Do not merge into `main` or begin M06 desktop-app implementation without that resolution.
