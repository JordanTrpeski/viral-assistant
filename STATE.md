# Jarvis — Current Development State

M03 remains complete and verified. Policy and repository-root maintenance are complete on `dev/efficiency-policy`; no task is active.

## Permanent policy guidance
`EFFICIENCY.md` is authoritative for model, context, reasoning-effort, escalation, session-compaction, and token/compute behavior. The connector-first boundary requires explicit, versioned interfaces between independent applications and major subsystems, including software Viral develops in the future. This integration changes policy documentation only; no Efficiency Governor or M04 functionality has been implemented.

## Repository root
The canonical Git repository root is `C:\Users\jorda\Desktop\viral-bootstrap`. The former nested repository under the outer `milestones` directory was consolidated upward with Git history, branches, remotes, tracked files, and ignored `.viral/` runtime data preserved. The final `milestones/` directory contains milestone specifications only.

## Verified work
- A long-running service drives bounded deterministic ticks and stops through an explicit shutdown controller.
- A replaceable store persists validated atomic JSON snapshots under the Git-ignored `.viral/runtime/` directory.
- The durable task model includes every required state, explicit `ownerInputRequired`, schedules, recurrence, conditions, owner responses, pause/resume, dependencies, verification, and bounded retry data.
- One-time tasks survive runtime reconstruction and execute when due; recurring tasks execute only at fixed due times.
- Owner-dependent tasks remain paused until explicit input is supplied.
- Model and general condition waits resume through modular condition adapters. The M02 model integration probes availability without running inference.
- Failed work uses bounded exponential backoff and reaches `FAILED`; dependency failures propagate without an unbounded loop.
- Important completion, failure, owner-input, model-wait, scheduled-start, retry, pause/resume, and recovery events are persisted and exposed to internal listeners.
- Interrupted `RUNNING` and `VERIFYING` tasks recover to `QUEUED` with at-least-once semantics and a recovery event.
- Typecheck, lint, all 36 tests, the 10-test M02 suite, and the 13-test M03 acceptance suite pass.

## Live evidence
`runtime-status` created and read a valid empty local snapshot at `.viral/runtime/state.json`; Git confirmed the directory is ignored. The service process started and polled without an LLM session. Clean shutdown and timer release are covered by the controlled service lifecycle test.

## Blockers
None.

## Next action
Await owner direction. Do not merge into main or begin M04 without owner approval.

Last verified implementation commit: 741cd486c64c74dcdc84dd7740c872af733d8bbd. Runtime persistence and repository development state are separate replaceable Bootstrap mechanisms.
