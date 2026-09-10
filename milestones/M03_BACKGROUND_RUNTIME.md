# M03 — Background Runtime and Scheduler

## Objective

Give Viral a durable deterministic runtime that can execute, schedule, pause, wait, retry, recover, and request owner input without keeping an LLM or coding-agent session open.

## Boundaries

- M03 is infrastructure only: no voice, desktop UI, browser or OS automation, calendar, finance, mobile, or M04+ work.
- Waiting and scheduling use clocks, timers, persisted state, and condition adapters rather than model prompts.
- Runtime state stays local under `.viral/runtime/` by default and is excluded from Git.
- The persistence interface must remain replaceable; do not add an external database server.
- Task handlers may integrate with existing local-brain or development abstractions, but the runtime itself remains deterministic and never silently guesses owner input.
- Preserve M00–M02 behavior and tests.

## Design

### A. Durable State

Define a `RuntimeStore` interface that loads and atomically saves one validated runtime snapshot containing tasks and events. Implement an embedded JSON-file store for M03. The store writes a temporary file and atomically renames it, so an interrupted write leaves the last complete snapshot recoverable.

Only one service process owns a runtime directory at a time in M03. Multi-process locking and the future personal-memory database are outside scope.

### B. Runtime Task Model

Every task includes a stable id, handler type, JSON-compatible payload, timestamps, state, dependencies, attempt/failure counts, bounded retry policy, optional schedule/recurrence, optional wait condition, explicit `ownerInputRequired`, optional supplied owner response, and bounded diagnostic/result fields.

Supported states:

- `QUEUED`
- `RUNNING`
- `SCHEDULED`
- `WAITING_FOR_TIME`
- `WAITING_FOR_CONDITION`
- `WAITING_FOR_MODEL`
- `WAITING_FOR_OWNER`
- `PAUSED`
- `VERIFYING`
- `COMPLETED`
- `FAILED`

### C. Scheduling and Dependencies

- A one-time task may start at or after an absolute timestamp.
- A recurring task uses a fixed positive interval in M03; cron syntax and calendar semantics remain future work.
- Tasks with dependencies run only after all dependencies complete.
- A task whose dependency permanently fails also fails with a clear diagnostic.
- Retries use bounded exponential backoff with configured maximum attempts and maximum delay.

### D. Conditions and Owner Input

Condition evaluation uses a registry of named, injectable deterministic `RuntimeCondition` implementations. `WAITING_FOR_CONDITION` and `WAITING_FOR_MODEL` tasks are checked only on runtime ticks. Merely waiting invokes no LLM or harness.

A handler can return `ownerInputRequired` with a prompt. The runtime persists the prompt and enters `WAITING_FOR_OWNER`. Only an explicit `supplyOwnerInput` call clears the requirement and requeues the task.

### E. Handlers and Verification

Task work is provided through a small `RuntimeTaskHandler` interface. A handler returns a typed outcome: completed, failed, waiting for owner, waiting for a condition, or waiting for model availability. Completed work enters `VERIFYING`; an optional deterministic verifier runs before final completion. Model output never directly changes infrastructure state.

The handler boundary can later wrap the M02 local brain or M01 development harness without coupling the queue to either provider.

### F. Events

Persist and publish internal events for at least:

- task completed,
- task failed,
- owner input required,
- waiting for model availability,
- scheduled task started.

Also record retry, pause/resume, and restart-recovery events where useful. Event listeners are internal interfaces; M03 adds no notification UI.

### G. Service Lifecycle and CLI

The long-running service repeatedly performs one bounded deterministic tick, then sleeps. Shutdown aborts its timer, stops accepting new work, and lets interrupted `RUNNING`/`VERIFYING` tasks remain recoverable. On startup, those states are requeued and a recovery event is recorded.

Expose scriptable commands:

```text
jarvis-dev runtime-start [--data-dir <path>] [--poll-ms <milliseconds>]
jarvis-dev runtime-status [--data-dir <path>] [--json]
```

Programmatic queue methods cover enqueue, pause, resume, owner response, ticking, and event subscription. Final UI and notification controls remain future work.

## Automated Acceptance Criteria

1. Every required task state is represented and validated.
2. JSON persistence is atomic, local, replaceable, and ignored by Git.
3. A future one-time task survives reconstruction of the runtime and executes afterward.
4. A fixed-interval recurring task executes more than once at its due times.
5. A task waits for explicit owner input and cannot continue before a response is supplied.
6. A model-waiting task resumes only after its injected availability condition becomes true.
7. Pause/resume works without losing the prior actionable/waiting state.
8. Dependency ordering is enforced and permanent dependency failure propagates cleanly.
9. Failure retries use bounded backoff and eventually reach `FAILED` without looping.
10. Successful work passes through `VERIFYING` and emits a persisted completion event.
11. Required failure, owner-input, model-wait, and scheduled-start events are persisted and observable through an internal listener.
12. Startup recovers interrupted `RUNNING` and `VERIFYING` tasks to a safe resumable state.
13. Waiting ticks do not invoke task handlers, the local brain, or coding harnesses.
14. Clean service shutdown resolves without leaving an active timer.
15. M00–M02 tests remain green; typecheck, lint, all tests, and focused M03 acceptance checks pass.

## Completion Output

- Update architecture, decisions, state, task, verification evidence, and checkpoint.
- Commit and push verified work on `dev/m03-background-runtime` using the owner's GitHub identity.
- Do not merge into `main` and do not begin M04.
