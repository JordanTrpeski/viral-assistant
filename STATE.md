# Jarvis — Current Development State

M00–M04 are complete and verified. M04 — Efficiency Governor was implemented on `dev/m04-efficiency-governor`; M05 has not started.

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

## Policy and repository
`EFFICIENCY.md` remains authoritative. D018 defines the owner-approved autonomy boundary and D020 records the implemented governor and private telemetry architecture. Independent applications and major subsystems continue to use explicit, versioned connector boundaries. The canonical Git root is `C:\Users\jorda\Desktop\viral-bootstrap`.

## Verification
M04 focused tests cover selection, effort escalation, owner gates, context budgets and compression fallback, fresh-session handoff, governed launch propagation, runtime waits, telemetry privacy/bounds, CLI behavior, and adapter support. The complete repository verification includes M00–M04 typecheck, lint, tests, and milestone acceptance checks.

## Blockers
None.

## Next action
Await owner direction. Do not merge into `main` or begin M05.
