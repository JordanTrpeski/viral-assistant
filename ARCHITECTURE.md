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

### 5. Verification Runner
Normal software executes:
- unit tests,
- integration tests where applicable,
- type checking,
- linting if configured,
- milestone-specific acceptance commands.

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
- local LLM/router,
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
