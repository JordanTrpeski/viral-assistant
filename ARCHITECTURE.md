# Jarvis — Bootstrap Architecture

## Current Architecture Status

This document describes Bootstrap V0 only. It is not the final life-assistant architecture.

## Bootstrap Goal

Provide a small TypeScript-based controller that can coordinate the development of Jarvis itself while preserving continuity across coding-agent sessions.

## Bootstrap Components

### 1. Repository Context
Human-readable authoritative product and engineering documents:
- PRODUCT.md
- PRINCIPLES.md
- RULES.md
- EFFICIENCY.md
- ROADMAP.md
- DECISIONS.md
- milestone specifications

### 2. Development State
Bootstrap continuity is represented by:
- STATE.json — machine-readable current development state
- STATE.md — concise human-readable summary

This mechanism is explicitly temporary/replaceable.

### 2a. Efficiency Policy

`EFFICIENCY.md` is the authoritative policy for model and reasoning-effort selection, context budgeting and progressive retrieval, failure-aware escalation, session compaction, model-switch handoffs, and token/compute efficiency. It separates stable rules, semi-stable project context, and dynamic task state, while keeping authoritative constraints as deterministic inclusions.

M04 implements the first practical Efficiency Governor under `src/efficiency/`. It converts explicit task facts into a validated, serializable capability, effort, owner-gate, retry, context, and session plan. Its output includes a concise practical reason and never stores or exposes hidden reasoning.

### 3. Task Model
A small task representation should track:
- id,
- objective,
- status,
- milestone,
- acceptance criteria,
- dependencies,
- current notes,
- next action,
- relevant files,
- verification status.

### 4. Development Harness Abstraction
A provider-neutral interface for authenticated coding-agent harnesses.

Initial intended harnesses:
- Codex CLI using the owner's authenticated Codex/ChatGPT account.
- Claude Code using the owner's authenticated Claude account.

Do not use OpenAI or Anthropic API billing as the default development path.

The first abstraction should be intentionally small. Do not attempt to normalize every vendor-specific feature.

M01 implements this boundary in `src/harness/`. Provider adapters depend on an injectable process runner and expose only probe and launch operations. Task packets contain repository paths and concise state rather than conversation history. Each run is recorded under `runs/`, linked from `STATE.json`, and summarized in `CHECKPOINT.md`. Provider API-key environment variables are removed from harness child processes; authentication remains owned by the installed CLI.

### 5. Verification Runner
Normal software executes:
- unit tests,
- integration tests where applicable,
- type checking,
- linting if configured,
- milestone-specific acceptance commands.

### 5a. Local Brain

M02 adds a provider-neutral local-model boundary under `src/local/`. Ollama is the first adapter and is accessed only through a validated loopback HTTP endpoint. Its CLI probe, HTTP transport, model choice, timeout, and cancellation behavior remain injectable and replaceable.

The local brain supports cheap request classification, concise summarization, relevant-context selection, and routing recommendations. Model output is parsed and bounded before use. A deterministic policy layer owns escalation categories and takes precedence for development work and consequential owner actions. The local brain never changes project state or launches a development harness; callers must separately decide and execute any permitted action.

### 5b. Background Runtime

M03 adds a long-running deterministic service under `src/runtime/`. A replaceable `RuntimeStore` persists tasks and internal events; the initial implementation uses atomic JSON snapshots under the Git-ignored `.viral/runtime/` directory. One service process owns a runtime directory. Interrupted `RUNNING` and `VERIFYING` tasks are requeued on startup, giving at-least-once execution after a crash. Task handlers should therefore make consequential side effects idempotent.

The engine owns scheduling, fixed-interval recurrence, condition checks, owner-input gates, pause/resume, dependencies, bounded retry backoff, verification transitions, and event generation. Work and condition adapters are injectable. The provided model-availability condition calls only the M02 availability probe while waiting; it does not run inference. The runtime has no direct dependency on a coding harness and never keeps an LLM session alive merely to wait.

### 5c. Efficiency Governor

M04 adds a provider-neutral deterministic governor under `src/efficiency/`. The governor selects deterministic software, the M02 local brain, or an M01 coding harness from explicit work, risk, availability, failure, and permission facts. It applies bounded LOW/MEDIUM/HIGH effort escalation, enforces owner gates before launch, and records the chosen tier, provider, effort, and practical reason in both task packets and run metadata.

The context planner always retains authoritative material, ranks optional material within configurable budgets, supports progressive retrieval, and may ask the local brain to compress only after deterministic filtering. The session planner emits bounded repository/task/checkpoint handoffs when context becomes inefficient. The runtime adapter represents unavailable capabilities as `WAITING_FOR_MODEL`; a timer only permits a probe, and only a successful provider probe permits resumption.

Bounded operational telemetry is persisted through a replaceable store under Git-ignored `.viral/efficiency/`. It records selection, budgets, waits, escalation, session resets, outcomes, and latency without prompts, conversations, credentials, private content, or hidden reasoning. The governor does not call cloud APIs and cannot bypass the existing harness authentication or sandbox boundaries.

### 5d. Connector-First Boundary

Independent applications and major subsystems integrate through explicit, versioned connectors or interfaces. Connectors own their request/response contracts, versioning, error semantics, and permission boundaries. Implementations should avoid direct access to another application's database, shared mutable state, or internal modules unless a strong reason and migration impact are recorded in `DECISIONS.md`.

This boundary applies to Viral's own model, harness, runtime, storage, and future tool integrations. It also applies by default to independent software Viral develops: cross-application behavior belongs behind a connector rather than relying on internal representation or database layout.

### 6. Git Checkpoint Controller
Normal software should be able to:
- inspect working-tree state,
- record the current branch and commit,
- commit verified progress,
- push permitted development branches,
- produce a concise handoff/checkpoint.

### 7. Development Loop

Conceptual flow:

Owner objective
→ load repository context
→ load current state
→ select active milestone/task
→ prepare concise task packet
→ execute selected coding harness
→ collect result
→ run verification
→ on success: checkpoint + update state
→ on failure: capture diagnostics + retry/escalate according to policy
→ continue or wait for owner/model availability.

The M04 governor automates harness/model and reasoning-effort selection, fresh-session planning, and permitted governed development launches within an owner-approved milestone. Each selection must emit a concise user-visible record of the selected capability, effort level, and practical reason without exposing hidden chain-of-thought.

When allowance is exhausted, deterministic runtime state may move work to `WAITING_FOR_MODEL`, store the earliest known reset time, wait without model usage, and probe actual availability at or after that time. A timer expiring does not establish availability. Switching to another paid/cloud harness remains owner-gated unless the owner explicitly configures automatic switching. Major product/rule/privacy/security/roadmap changes and major merges into `main` remain owner-gated during bootstrap.

## Important Boundary

The coding agent is a worker inside the development loop. It is not the sole manager, verifier, or source of truth.

## Future Architecture

Future modules may include:
- voice input/output,
- desktop overlay/full UI,
- OS automation,
- browser automation,
- personal memory,
- calendar,
- finance,
- workout/life planning,
- notifications,
- mobile/remote interface.

They are out of scope for Bootstrap V0 unless required to support development continuity.
