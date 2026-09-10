# Viral — AI Efficiency and Token Policy

## Purpose

Viral should optimize for reliable task completion per unit of compute and token usage.

The goal is not to minimize tokens at any cost. A weak model failing repeatedly can be more expensive than a strong model succeeding once.

Viral should therefore use the least expensive computation that can reliably complete the task, and escalate capability, reasoning effort, or context only when evidence justifies it.

## 1. Deterministic Before LLM

Do not use an LLM for information or operations that normal software can determine reliably.

Examples include Git status/branch/commit/diff, test results, scheduler timing, task state transitions, model availability probes, quota timers when known, file metadata, dependency state, process exit codes, and permission enforcement.

LLMs may interpret these results, but should not infer them when deterministic tools can provide them.

## 2. Local Before Cloud

Prefer local computation when it can complete the task reliably.

Default order:
1. Deterministic code/tools.
2. Local model.
3. Authenticated coding harness / cloud model when required.

Good local-model tasks include request classification, concise summarization, context relevance scoring, simple routing recommendations, transcript cleanup, lightweight planning, and state summarization.

Do not send private local information to a cloud model unless the task requires it and existing privacy/permission policy allows it.

## 3. Cheapest Sufficient Capability

Do not default every task to the strongest available model or highest reasoning effort.

Classify work approximately as LOW, MEDIUM, or HIGH.

LOW examples: formatting, simple documentation updates, straightforward state updates, small mechanical refactors, simple test generation, trivial bug fixes. Prefer local/fast models and low reasoning effort.

MEDIUM examples: normal feature implementation, repository investigation, moderate debugging, non-trivial tests, ordinary refactors. Prefer a capable coding model and medium reasoning effort.

HIGH examples: architecture changes, difficult multi-file bugs, concurrency problems, security-sensitive design, repeated failures, major refactors, ambiguous root-cause analysis. Prefer the strongest appropriate model, high reasoning effort, and independent verification where justified.

Start at the lowest level reasonably expected to succeed.

## 4. Failure-Aware Escalation

Avoid repeated low-capability attempts that consume more tokens than a single stronger attempt.

Default escalation pattern:
LOW -> failure/insufficient confidence -> MEDIUM -> repeated failure/architectural complexity -> HIGH.

Escalation may also occur when tests fail repeatedly, task scope expands, the model identifies uncertainty, a safety/security-sensitive issue appears, or an architectural decision is required.

Retries must remain bounded.

## 5. Context Is a Budget

Context should be treated as a managed resource.

Never send an entire repository, full conversation history, or large historical logs unless demonstrably necessary.

Initial context should normally include only the current objective, active milestone/task, relevant rules, relevant architecture decisions, current state, relevant files, Git diff, current failures/diagnostics, and next action.

Additional context should be retrieved progressively when needed.

## 6. Progressive Context Loading

Prefer small initial context -> model identifies missing information -> retrieve specific context -> continue, rather than loading everything “just in case.”

Where practical, expose retrieval for architecture sections, previous decisions, relevant files, prior checkpoints, detailed test failures, and dependency information.

## 7. Context Relevance Scoring

When selecting context, consider relevance, recency, authority, dependency relationship, and token cost.

High-authority information such as RULES.md or an active architectural decision should outrank old discussion. Large low-relevance content should be excluded.

## 8. Compact Resolved Work

Once work is resolved, replace detailed historical reasoning with a concise durable result containing issue, cause, fix, files changed, tests, commit, and status.

Raw detailed logs may be archived locally if useful, but should not be injected by default.

## 9. Fresh Session Policy

Do not preserve a model session merely because it already exists.

Consider checkpointing and opening a fresh session when much of the existing context relates to completed work, the task materially changed, context became noisy/redundant, a concise checkpoint can represent useful state more cheaply, or the current session is becoming inefficiently large.

A fresh session should receive a concise task packet, relevant state, required rules, relevant files/diff, unresolved failures, and next action.

Exact thresholds should eventually be learned empirically rather than permanently hard-coded.

## 10. Context Headroom

Avoid routinely filling a model's context window. Maximum context capacity is not a target.

## 11. Concise Outputs

Reasoning effort and response verbosity are separate.

A task may require high reasoning but only a short machine-facing result. Prefer structured completion output such as STATUS, CHANGES, VERIFICATION, BLOCKERS, NEXT_ACTION.

Avoid long narrative summaries when a compact state update is sufficient.

## 12. Stable and Dynamic Prompt Separation

Structure model input as:

STABLE: core rules, tool contracts, stable architecture guidance.

SEMI-STABLE: project context, current milestone.

DYNAMIC: active task, latest diff, current failures, immediate next action.

This improves clarity and may improve prompt/cache reuse where supported.

## 13. Token and Compute Telemetry

Viral should eventually track model/harness used, reasoning effort, input/output tokens, allowance usage when available, retries, context size, local-model calls, coding-harness calls, task success/failure, session restarts, escalation events, latency, and relevant cost data.

Keep private telemetry local by default.

## 14. Efficiency Regression Tests

Representative operations should eventually have expected efficiency envelopes.

Examples: simple project-state summary should require no cloud model; routine classification should prefer local inference; simple code changes should not load unrelated repository context; waiting for quota reset must consume zero LLM tokens while waiting.

Treat major unexplained context/model-usage increases as performance regressions.

## 15. Model Availability and Reset Handling

When a preferred coding harness/model becomes unavailable:
1. Save a concise checkpoint.
2. Stop active model work.
3. Move task to WAITING_FOR_MODEL.
4. Record earliest known reset/retry time when available.
5. Wait using deterministic scheduler logic with zero LLM usage.
6. At/after that time, probe actual availability.
7. Resume only when availability is confirmed.
8. If another suitable model is available, follow owner policy about whether switching requires approval.

Timer expiration is the earliest retry time, not proof of model availability.

## 16. Model Switching Policy

Model switching should preserve continuity through repository/task/checkpoint state rather than conversation transfer.

Do not copy full previous model conversations by default.

A handoff should normally contain objective, current state, completed work, unresolved issue, relevant files, verification status, Git state, and next action.

Owner policy controls whether model switching is automatic or requires confirmation.

## 17. Local Context Compression

The local brain should eventually act as a preprocessor for expensive models:
raw project information -> deterministic filtering -> local relevance selection/summarization -> compact task packet -> coding harness/stronger model.

The local model must not silently remove authoritative constraints. Core rules and explicit owner instructions should remain deterministic inclusions.

## 18. Do Not Optimize Into Failure

Efficiency is subordinate to correctness, safety, and task completion.

Do not omit required context merely to hit a token target, use a weaker model after repeated evidence it cannot solve the task, skip verification to save tokens, hide blockers/uncertainty through over-compression, or weaken owner-required safety checks for efficiency.

The primary metric is successful, verified work with minimal unnecessary compute.

## 19. Owner Overrides

The owner may override default efficiency policy with instructions such as “Be economical,” “Use maximum effort,” “Do not use Codex until reset,” “Use local only,” “Ask before switching models,” or “Use the strongest model for this.”

Explicit owner instructions override automatic optimization unless doing so would violate safety, privacy, or immutable rules.

## 20. Implementation Guidance

This document defines policy, not a requirement to build every mechanism immediately.

M02 provides the local-brain foundation. M03 provides waiting/scheduling/runtime infrastructure. M04 should implement the first practical Efficiency Governor for autonomous development.

The Efficiency Governor should initially remain simple, observable, and easy to override. More advanced adaptive optimization should be based on measured Viral usage rather than assumptions.
