# M04 — Efficiency Governor

## Objective

Implement Viral's first small, deterministic, observable, and owner-overridable Efficiency Governor for autonomous development. It applies `EFFICIENCY.md` to capability and reasoning-effort selection, progressive context loading, bounded escalation, session compaction, model-availability waits, and local telemetry while preserving owner gates and all M00–M03 behavior.

## Boundaries

- `EFFICIENCY.md` and D018 are authoritative.
- Deterministic policy owns selection, permission gates, state transitions, retry bounds, and resume decisions. Local-model output is advisory and validated.
- Default capability order is deterministic software, then the configured local model, then the owner's authenticated development harness when justified.
- Do not add OpenAI, Anthropic, or other cloud APIs, keys, or API billing.
- Do not bypass harness sandbox, authentication, or permission controls.
- Switching to another paid/cloud harness requires owner approval unless explicitly enabled in configuration.
- Major changes to product/rules/privacy/security/roadmap direction and major merges into `main` remain owner-gated.
- Do not implement voice, desktop UI, browser or OS automation, calendar, finance, personal memory, mobile features, or any M05 work.

## Required Design

### A. Provider-Neutral Governor Contract

Define small typed contracts for:

- work classification and deterministic facts,
- capability tier (`DETERMINISTIC`, `LOCAL_MODEL`, `CODING_HARNESS`),
- reasoning effort (`LOW`, `MEDIUM`, `HIGH`),
- action (`EXECUTE`, `WAITING_FOR_MODEL`, `OWNER_INPUT_REQUIRED`, `UNSURE`),
- selected model/harness and availability evidence,
- context/session metrics,
- concise user-visible selection reason,
- retry/escalation metadata.

Every plan must be structured, validated, and serializable without hidden reasoning traces.

### B. Deterministic Selection and Owner Gates

- Select deterministic execution when the caller identifies a reliable deterministic operation.
- Use the M02 local brain for cheap classification, summarization, relevance selection, and routing when available.
- Select the configured primary coding harness for implementation work when it is usable.
- Choose LOW, MEDIUM, or HIGH effort from explicit task risk/complexity/failure signals.
- Escalate after bounded failure evidence rather than repeatedly retrying an insufficient capability.
- Default paid/cloud switching to disabled. An alternate paid harness may be selected only when owner approval or explicit automatic-switch configuration is present.
- Consequential owner decisions and permanent owner-gated changes return `OWNER_INPUT_REQUIRED`.

### C. Context and Fresh-Session Planning

- Keep authoritative rules and owner instructions as mandatory deterministic inclusions.
- Rank optional context by authority, relevance, recency, dependency relationship, and character cost.
- Enforce configurable initial and maximum context budgets.
- Return excluded identifiers so callers can retrieve more context progressively.
- Use local summarization/relevance selection only after deterministic filtering and fall back safely if it fails.
- Recommend a fresh coding session when configurable context/noise/completed-work thresholds are exceeded.
- Generate a concise handoff containing objective, state, completed work, unresolved issues, relevant files, verification, Git state, and next action rather than conversation history.

### D. Governed Harness Execution

- Add an explicit governed development-task entry point that plans first and launches only an authorized selected harness.
- Propagate the selected reasoning-effort level to a harness through its provider adapter where supported.
- Include the user-visible selection record in the repository-derived task packet and persisted run metadata.
- Preserve the existing explicit `run <codex|claude>` command and M01 contracts.
- A blocked selection must not launch a harness.

### E. Model Availability and Runtime Integration

- Represent unavailable preferred capability as `WAITING_FOR_MODEL` with the earliest known retry/reset time when available.
- Timer expiry permits a probe; it does not establish availability.
- Resume only after the actual selected local model or harness probe confirms usability.
- Waiting must use M03 deterministic runtime/condition interfaces and consume zero inference or harness calls merely because time passes.
- Support a governed development handler/condition through replaceable interfaces without coupling the queue to vendor internals.

### F. Local Efficiency Telemetry

Persist bounded, non-sensitive local telemetry under Git-ignored `.viral/efficiency/` through a replaceable store. Record at minimum:

- selected tier/model/harness,
- effort,
- concise practical reason,
- context size/budget,
- retry/escalation/session-reset events,
- availability/wait decisions,
- outcome and latency where known.

Do not store prompts, conversation history, credentials, hidden reasoning, or private owner content. Expose a scriptable status/report command.

### G. Configuration and CLI

Extend configuration with explicit, validated governor defaults and thresholds. Provide commands analogous to:

```text
jarvis-dev efficiency-plan <task-id> [--json]
jarvis-dev efficiency-run <task-id> [--timeout-ms <milliseconds>] [--json]
jarvis-dev efficiency-status [--json]
```

The plan command must be side-effect-light except for bounded telemetry. The run command must honor all owner gates. Existing commands remain supported.

## Automated Acceptance Criteria

1. Typed, provider-neutral governor contracts and validated configuration exist.
2. Deterministic, local, and coding-harness representative work select the expected tier and effort.
3. Architecture/security/repeated-failure signals raise effort predictably; retries and escalation are bounded.
4. Every decision includes a concise user-visible selection reason without hidden chain-of-thought.
5. Paid/cloud harness switching is blocked for owner input by default and works only with explicit authorization/configuration.
6. Major policy/direction and consequential requests are owner-gated deterministically.
7. Authoritative context is always included; optional context obeys budgets and supports progressive retrieval.
8. A large synthetic context is reduced substantially with a safe deterministic fallback when local compression fails.
9. Fresh-session recommendation produces a concise repository/task/checkpoint-based handoff without prior conversation history.
10. Governed execution launches only the selected authorized harness, propagates effort where supported, and persists its selection record.
11. Blocked, unsure, and waiting decisions invoke no harness.
12. A model-wait task records an earliest retry time, remains idle before it, probes at/after it, and resumes only after confirmed availability.
13. Waiting consumes no local inference or harness execution calls.
14. Telemetry is bounded, local, replaceable, Git-ignored, and contains no prompt/conversation/credential data.
15. CLI planning, execution-blocking, and telemetry status are scriptable and return non-zero on genuine failures.
16. No direct cloud model API or M05 functionality is introduced.
17. M00–M03 tests remain green; build, typecheck, lint, all tests, and focused M04 acceptance checks pass.

## Completion Output

- Update architecture, decisions, state, task, verification evidence, and checkpoint.
- Commit and push verified work on `dev/m04-efficiency-governor` using the owner's GitHub identity.
- Do not merge into `main` and do not begin M05.
