# M04 — Completion Report

M04 turns Viral from a single-shot command runner into a **governed, self-developing, autonomous
daemon** with token/session discipline, an objective-refinement gate, and full execution visibility.
This document records what M04 accomplishes, what has been proven, the architecture, and what is
deliberately deferred to Phase 2.

## What M04 accomplishes

- **Self-development.** `viral-dev objective "<text>"` creates a durable task, runs it through the
  Efficiency Governor, and — for development work — launches the Claude Code coding harness to
  implement it, then verifies, commits, and pushes through the deterministic finalizer. Proven
  end-to-end: a real objective produced a working, tested feature and was committed autonomously.
- **Token & session management.** Objective planning feeds real session-context signals
  (`contextCharacters`, completed/noise ratios) to the governor so `freshSession()` detection is live;
  when a fresh session is warranted the coordinator hands the harness a compact, repository-derived
  handoff instead of replaying history, and the task packet is assembled through an adaptive,
  budget-respecting context planner.
- **Objective refinement gate.** A vague `build`/`analyze`/`research` objective is returned to the
  owner as `OWNER_INPUT_REQUIRED` with clarifying questions embedded, rather than guessing at unstated
  scope. Objectives that already carry a concrete spec pass straight through.
- **Daemon autonomy.** The runtime (`ViralRuntime` + `RuntimeService`) continuously drains a queue of
  tasks with no user input, retries failures with bounded backoff, orders dependencies, and recovers
  interrupted work on restart.
- **Visibility.** Every task-lifecycle event is written to an append-only JSONL log
  (`.viral/logs/tasks-YYYY-MM-DD.jsonl`); `viral-dev summary [days]` and `viral-dev task-detail <id>`
  make an overnight run legible.

## What has been proven

- **Autonomous multi-task execution.** The daemon executes three queued development objectives to
  completion with no user input (`tests/daemon-execution.test.ts`). The generated artifacts are real
  ES modules and verification *executes* them (not mocks).
- **Resume from checkpoint.** When the daemon is killed mid-task, the persisted snapshot keeps the
  interrupted task `RUNNING`; a fresh runtime recovers it to `QUEUED` (`TASK_RECOVERED`) and finishes
  the queue. Completed work is **not** re-executed (execution counts `A=1, B=2, C=1`).
- **Failure handling.** A failing task is retried up to its limit (`attemptCount == maxAttempts`),
  emits `TASK_RETRY_SCHEDULED` then `TASK_FAILED`, and does **not** block unrelated tasks, which still
  complete. The failure is visible as an event and in `lastError`.
- **Fresh-session resume, not replay.** With context past the threshold, execution routes to the
  compact handoff (`tests/session-management.test.ts`) while retaining the safety Operating Constraints.
- **Refinement gate.** Vague objectives ("build voice interface", "make me a Slovenian learning app")
  return domain-aware questions; specific ones do not (`tests/refinement.test.ts`).
- **Verification.** 94 repository tests pass, plus the M02/M03/M04 acceptance suites (10/13/17) and lint.

## Architecture overview

```
objective (CLI)
  → OwnerObjectiveService.submit            src/objective.ts
  → GovernedDevelopmentExecutor.planObjectiveTask   src/efficiency/execution.ts
      (derives session metrics + workKind, then governor.plan)
  → EfficiencyGovernor.plan                 src/efficiency/governor.ts
      (refinement gate → owner gate → deterministic/local/harness selection)
  → GovernedDevelopmentExecutor.executeDecision
  → launchTask                              src/harness/coordinator.ts
      (fresh-session handoff OR budget-aware task packet)
  → DevelopmentHarness.launch               src/harness/claude.ts | codex.ts
  → verification + DevelopmentFinalizer      src/finalization.ts
```

The durable daemon (`ViralRuntime`/`RuntimeService`, `src/runtime/`) wraps this: it schedules,
retries, recovers, and — via `TaskLogger` — logs every lifecycle event. See
[M04-ARCHITECTURE.md](M04-ARCHITECTURE.md) for the detailed flow.

## Gap analysis — deferred to Phase 2

- **LOCAL_MODEL connector access.** The local reasoning layer is a sandboxed, loopback-only,
  text-in/text-out reasoner. It cannot read or write connectors (calendar, email, notes, finance).
  Bidirectional connector access (a `ConnectorRegistry` injected into `LocalBrain`, plus an
  owner-gated write loop) is designed but **not** implemented — see `src/local/ANALYSIS.md`.
- **Objective decomposition.** M04 refines a vague objective by *asking questions*; it does not yet
  break a large objective into a dependency graph of sub-objectives and schedule them. Automatic
  decomposition/planning is Phase 2.
- **Adaptive budgeting is wired but rarely binding.** The task packet carries filenames and summaries
  (not full file bodies), so context trimming seldom triggers in practice today; the mechanism is in
  place for when sections grow.
- **Live multi-task daemon at scale.** Autonomous execution is proven deterministically and with one
  real end-to-end code-gen run; sustained overnight operation across many live harness runs has not
  been exercised in CI (it is cost- and environment-bound).
