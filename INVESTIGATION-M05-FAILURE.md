# Investigation — the "M05 voice failure"

Run under investigation: `runs/20260911203724126-claude-OBJ-20260911203723723.json`
(objective `OBJ-20260911203723723`, harness `claude`, branch `feat/m05-voice`).

## TL;DR

**There was no build, test, or import failure.** The run **succeeded** (`exitCode: 0`,
`succeeded: true`, `timedOut: false`, `error: null`, **`stderr` empty**). The harness *deliberately
declined to implement any voice code* because the objective was out-of-scope **M05** work that had not
been owner-approved. The "failure" framing is a misread of a governance refusal that was recorded via
commits mislabeled as a completed implementation.

## What was attempted

The objective:

> "Build a voice interface CLI that uses Whisper (local) for STT, Piper TTS (local) for output, 16kHz
> mono, 2s silence timeout, interrupt support. CLI: `viral-dev voice listen --timeout 30s`. Include tests."

`viral-dev objective` auto-tagged the task under the then-active milestone **`M04_EFFICIENCY_GOVERNOR`**
(already complete). The governor selected `CODING_HARNESS / claude / MEDIUM` and launched the harness.

## What the harness actually did (from the run's stream-json, 203 events)

It performed a governance review and a verification pass — and wrote **no** voice files:

- **Read** `AGENTS.md`, `RULES.md`, `ROADMAP.md`, `DECISIONS.md`, `STATE.json`/`STATE.md`,
  `CHECKPOINT.md`, the packet, both objective tasks, and the prior run record.
- **Ran** `pnpm run typecheck && pnpm run test && pnpm run lint` — all green (95 tests).
- **Edited** `tasks/OBJ-20260911203723723.json`, `STATE.json`, `STATE.md`, `CHECKPOINT.md` to record a
  block, then **committed** `chore: block OBJ-20260911203723723 …` and pushed to `feat/m05-voice`.
- **No `Write` to `voice.ts`, `voice.test.ts`, or any `src/`/`tests/` file.** They never existed.

## What "failed" and why — the exact message

Nothing errored. `stderr` was empty and the process exited 0. The harness's own terminal result was a
deliberate refusal, quoted verbatim:

> **No code was implemented.** `OBJ-20260911203723723` is a duplicate resubmission (identical text) of
> `OBJ-20260911203148743`, which the previous session already blocked: this is M05 Voice Interface work
> (Whisper/Piper), but the active milestone is `M04_EFFICIENCY_GOVERNOR`, already complete, and its own
> spec plus `ROADMAP.md`/`AGENTS.md`/`DECISIONS.md` D017 explicitly reserve opening M05 to the owner.
> Resubmitting the same objective text isn't an approval. … **This needs your decision:** either
> explicitly approve opening M05 … or re-scope/cancel …

Run-record facts: `exitCode 0`, `succeeded true`, `timedOut false`, `error null`, `stderr` length `0`,
`stdout` length `378487`, `terminal_reason: completed`, `is_error: false`, `num_turns: 34`.

## Root cause analysis

1. **Primary cause — scope/governance, not code.** The objective is M05 (Voice Interface) work.
   Per **D017**, `ROADMAP.md`, and `AGENTS.md` Scope Discipline, opening a later milestone is reserved
   to the owner. M04 was the active milestone and its spec explicitly forbids voice/M05 work. A duplicate
   resubmission of an already-blocked objective is not owner approval. The harness correctly refused —
   the guardrail worked exactly as intended.

2. **Contributing process wart #1 — no dedup.** `viral-dev objective` does not deduplicate identical
   resubmissions, so `OBJ-20260911203723723` was created as a second task with the same text as the
   already-blocked `OBJ-20260911203148743`.

3. **Contributing process wart #2 — misleading completion labeling.** The objective service treated the
   successful-but-no-op harness run as a completion and ran the deterministic finalizer, producing commits
   labeled `feat: complete OBJ-20260911203723723 implementation` and `docs: finalize … lifecycle`, and a
   task `status: complete`. Those commits contain **only bookkeeping** (`STATE.json`, `CHECKPOINT.md`, the
   run record) — no implementation. This mislabeling is what made the run look like a "completed build
   that then failed," when in fact nothing was built. (This is the strongest candidate for a real fix in
   the objective/finalization path: a run that produced no working-tree change beyond bookkeeping and
   that the agent flagged as a block should be recorded as `blocked`, not `complete`.)

## What would have fixed it

- **Not a code fix.** No assertion, import, or build change would have changed the outcome, because no
  code ran and no test failed.
- **The correct fix was owner approval to open M05** — subsequently granted as **D024** (2026-09-12),
  which set `M05_VOICE_INTERFACE` as the active milestone and added `milestones/M05_VOICE_INTERFACE.md`.
  With M05 active, the same objective is in-scope and the governance refusal no longer applies.
- Optional hardening: (a) dedupe identical objective resubmissions; (b) record a no-op/blocked harness
  outcome as `blocked` rather than finalizing it as `complete`.

## Does the issue still exist? (point 5)

**There is no "successful M05" to check — voice was never implemented.** Sequence of events:

1. **This run (pre-approval):** governance refusal, no code. ✅ Correct behavior.
2. **After D024 approval, re-run `OBJ-20260912055517868`:** routed correctly to `CODING_HARNESS / claude`
   but failed immediately (~2s) with `Failed to authenticate: OAuth session expired and could not be
   refreshed` (`terminal_reason: api_error`). **Again no code was generated** — an unrelated Claude Code
   CLI login expiry, not a governance or build issue.

So on `feat/m05-voice` today there are **no `voice.ts`/`voice.test.ts`** and the suite is 95 tests (no
voice tests). The original governance block is **resolved** (M05 is now open via D024), so it will not
recur; but the voice feature is still unbuilt, currently blocked only by the expired Claude Code CLI
session. Re-authenticate the CLI (`claude` → sign in; confirm with `viral-dev harnesses --json` showing
`claude usable: true`), then re-run the objective to produce the actual voice implementation — at which
point any *real* build/test errors can be investigated.
