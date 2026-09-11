# M04 — Architecture

The full path from an owner objective to a verified, published change, including the refinement gate,
governor decision, session/context budgeting, harness launch, verification, and finalization.

## End-to-end flow

```
viral-dev objective "<text>"                         src/cli.ts
        │
        ▼
OwnerObjectiveService.submit(objective)              src/objective.ts
        │  creates a durable OBJ task, applies policyHints (owner gates, risk),
        │  focuses state, then asks the executor to plan it
        ▼
GovernedDevelopmentExecutor.planObjectiveTask        src/efficiency/execution.ts
        │  deriveSessionMetrics(task)  ── contextCharacters, completed/noise ratios
        │  workKind = "development" when policy says CODING_HARNESS_REQUIRED
        ▼
EfficiencyGovernor.plan(request)                     src/efficiency/governor.ts
        │  1. REFINEMENT GATE  → ObjectiveRefiner.clarify(objective)   src/efficiency/refinement.ts
        │        vague build/analyze/research  → OWNER_INPUT_REQUIRED (+clarifyingQuestions)
        │  2. owner gate / bounded-retry limit → OWNER_INPUT_REQUIRED
        │  3. deterministicAvailable            → EXECUTE (DETERMINISTIC)
        │  4. kind():
        │        owner        → OWNER_INPUT_REQUIRED
        │        local_reasoning + local usable → EXECUTE (LOCAL_MODEL)
        │        development   → harnessDecision()
        │  effort(): development ⇒ MEDIUM (HIGH on risk/architecture/security/failures)
        │  freshSessionRecommended = freshSession(request)
        ▼
harnessDecision → EXECUTE (CODING_HARNESS, harness = primaryHarness)   [or WAITING_FOR_MODEL / owner approval]
        │
        ▼
GovernedDevelopmentExecutor.executeDecision          src/efficiency/execution.ts
        │  forwards reasoningEffort, model, selection, and freshSessionRecommended (when true)
        ▼
launchTask(root, harness, taskId, timeout, options)  src/harness/coordinator.ts
        │  loadProjectContext(root)     ── fails fast if required docs are missing
        │  loadConfigSafe(root)         ── budget = { initial/maximum ContextCharacters }
        │  if options.freshSessionRecommended:
        │        prepareSessionHandoff() ── compact, repo-derived handoff + Operating Constraints
        │  else:
        │        prepareTaskPacket(..., budget)  ── EfficiencyContextPlanner ranks + trims sections
        ▼
DevelopmentHarness.launch({ packet, ... })           src/harness/claude.ts (primary) | codex.ts
        │  claude -p --output-format stream-json --verbose
        │         --permission-mode bypassPermissions --max-turns 60 [--model X]
        │  packet delivered on stdin; run recorded to runs/<id>.json
        ▼
verification (viral-dev.config.json commands)        src/verification.ts
        ▼
DevelopmentFinalizer.finalize(taskId)                src/finalization.ts
        │  requires: passing verification, non-main branch, owner identity + remote, push preflight
        │  commits implementation, then commits + pushes completion (two-phase, journaled, idempotent)
        ▼
task COMPLETE
```

## Session & context budget wiring

The token/session mechanism (M04.2) connects three previously inert components:

- **`deriveSessionMetrics(task)`** (`src/efficiency/session.ts`) turns durable task state (objective,
  acceptance, relevant files, notes) into `contextCharacters`, `completedContextRatio`, and
  `contextNoiseRatio`. `planObjectiveTask` attaches these to the `GovernorRequest`.
- **`EfficiencyGovernor.freshSession()`** compares those signals to
  `freshSessionCharacters / freshSessionCompletedRatio / freshSessionNoiseRatio` and sets
  `decision.freshSessionRecommended`.
- **`launchTask`** branches on that flag:
  - **fresh** → `EfficiencySessionPlanner.plan()` builds a bounded (≤8k char) handoff reconstructed
    from repository state — no conversation replay — with the mandatory Operating Constraints appended.
  - **normal** → `prepareTaskPacket()` routes sections (mandatory: Required Reading, Task, Current
    State, Efficiency Selection, Operating Constraints; situational: Git, Verification, Previous Run)
    through **`EfficiencyContextPlanner`**, which keeps mandatory sections and ranks/trims the rest to
    the configured `initialContextCharacters`, bounded by `maximumContextCharacters`.

Because the packet carries filenames and summaries rather than file bodies, trimming rarely binds
today, but the budget is enforced and will bind as sections grow.

## Refinement gate

`EfficiencyGovernor.plan()` calls `ObjectiveRefiner.clarify(objective)` **first**
(`src/efficiency/refinement.ts`):

- Detects `build` / `analyze` / `research` intent (note: `implement`/`add` are intentionally *not*
  triggers — they name already-scoped work).
- If the objective already contains ≥2 concrete spec tokens (function, returns, array, json, schema…)
  it passes through.
- Otherwise it returns domain-aware questions — voice (STT/TTS/sample-rate/timeout/interrupt),
  language-learning (level/content/format) — or the generic template (scope/tech/timeline/output).
- Questions are surfaced structurally via `SelectionDecision.clarifyingQuestions` alongside an
  `OWNER_INPUT_REQUIRED` action.

## Daemon, retries, recovery, and logs

`ViralRuntime` (`src/runtime/engine.ts`) is the durable task engine; `RuntimeService`
(`src/runtime/service.ts`) is the polling loop ("the daemon"). Task handlers and conditions are
injected (`src/runtime/registry.ts`), and the governed development handler wraps `executeDecision`.

- **Retries:** a failed task enters `WAITING_FOR_TIME` with bounded exponential backoff and is
  re-queued when due; on exhausting `retryPolicy.maxAttempts` it becomes `FAILED`.
- **Recovery:** on `initialize()`, tasks left `RUNNING`/`VERIFYING` by an interrupted process are
  re-queued (`TASK_RECOVERED`) — resume-from-checkpoint, not restart-from-zero.
- **Logging:** `createDefaultRuntime` attaches a `TaskLogger` (`src/efficiency/logs.ts`) to the
  runtime's event stream; every `TASK_QUEUED / TASK_EXECUTING / TASK_COMPLETED / TASK_FAILED /
  TASK_RETRY_SCHEDULED / TASK_RECOVERED` event is appended to `.viral/logs/tasks-YYYY-MM-DD.jsonl`.
  `viral-dev summary [days]` and `viral-dev task-detail <id>` read those logs.
