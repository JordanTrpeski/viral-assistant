# Jarvis — Current Development State

M00–M03 remain complete and verified. M04 — Efficiency Governor is active on `dev/m04-efficiency-governor` with task `M04-001` in progress.

## Permanent policy guidance
`EFFICIENCY.md` is authoritative for model, context, reasoning-effort, escalation, session-compaction, and token/compute behavior. The connector-first boundary requires explicit, versioned interfaces between independent applications and major subsystems, including software Viral develops in the future. This integration changes policy documentation only; no Efficiency Governor or M04 functionality has been implemented.

## Local brain live setup
Ollama 0.34.0 and `qwen3:4b-instruct` are installed and live-validated. The preferred 4.0B Q4_K_M instruction model is approximately 2.5 GB, fits fully in the GTX 1070's 8 GB VRAM, and completed classification, summarization, relevance selection, routing, and direct inference through Viral's loopback-only adapter. No cloud model API was added.

## Pre-M04 autonomy policy
D018 records the owner-approved autonomy boundary. Viral may select harness/model/effort, create subtasks, compact into fresh sessions, and continue permitted development operations inside an approved milestone. Selection reasons must be concise and user-visible. Deterministic `WAITING_FOR_MODEL` recovery must confirm actual availability. Paid/cloud harness switching, major policy/direction changes, and major merges into `main` remain owner-gated by default. This records policy only; M04 has not started.

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
Implement and objectively verify M04 only. Do not merge into main or begin M05.

Last verified implementation commit: 741cd486c64c74dcdc84dd7740c872af733d8bbd. Runtime persistence and repository development state are separate replaceable Bootstrap mechanisms.
