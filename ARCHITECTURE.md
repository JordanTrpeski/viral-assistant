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
- ROADMAP.md
- DECISIONS.md
- milestone specifications

### 2. Development State
Bootstrap continuity is represented by:
- STATE.json — machine-readable current development state
- STATE.md — concise human-readable summary

This mechanism is explicitly temporary/replaceable.

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

## Important Boundary

The coding agent is a worker inside the development loop. It is not the sole manager, verifier, or source of truth.

## Future Architecture

Future modules may include:
- scheduler/background service,
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
