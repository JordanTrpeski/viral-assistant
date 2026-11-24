# M00 — Bootstrap Self-Development Core

## Objective

Build the smallest TypeScript-based development controller that allows Viral development to survive coding-agent/session changes without relying on chat history.

The result should be understandable, testable, and intentionally small.

## Why This Exists

Before Viral gains voice, browser automation, local AI, scheduling, or life-assistant features, it needs a reliable mechanism for coordinating its own development.

M00 builds that mechanism.

## Required Capabilities

### A. Project Context Loader

Implement a module that can load and validate the required bootstrap context:
- PRODUCT.md
- PRINCIPLES.md
- RULES.md
- ARCHITECTURE.md
- ROADMAP.md
- DECISIONS.md
- STATE.json
- STATE.md
- active milestone file

It should fail clearly when required context is missing or malformed.

### B. Development State Model

Implement a typed model/schema for Bootstrap V0 development state.

It must support at minimum:
- current milestone,
- milestone status,
- active task,
- completed tasks,
- blockers,
- last verified commit,
- last checkpoint,
- next action.

Do not over-engineer this because repository state is explicitly replaceable later.

### C. Task Model

Implement a small typed development-task model supporting:
- id,
- milestone,
- objective,
- status,
- acceptance criteria,
- dependencies,
- relevant files,
- notes,
- next action,
- verification result.

Persist tasks locally in a simple repository-visible bootstrap format that contains no private owner data.

### D. Checkpoint/Handoff Generator

Implement a deterministic command that can generate a concise development checkpoint containing at least:
- active milestone,
- active task,
- branch,
- HEAD commit,
- working-tree status,
- files changed,
- verification commands/results available,
- blockers,
- next action.

The checkpoint should be suitable for another coding agent to continue from without receiving previous chat history.

### E. Verification Runner

Implement a normal software runner capable of executing configured project verification commands.

For M00 this should include, once configured:
- TypeScript type check,
- unit tests,
- any lint command adopted by the project.

Verification output must be captured in a structured result.

### F. Git Inspection

Implement safe read-only Git inspection needed by checkpointing:
- current branch,
- HEAD commit,
- working-tree changes,
- recent commit metadata if useful.

Automatic commit/push behavior may be implemented only if doing so remains small and well-tested; otherwise it may be completed in the next milestone. M00 must at least establish the interface and checkpoint information needed for it.

### G. CLI

Provide a small Viral development CLI.

Preferred command shape may evolve, but M00 should expose useful commands analogous to:

- `viral-dev status`
- `viral-dev verify`
- `viral-dev checkpoint`
- `viral-dev context`

The CLI must be scriptable and return non-zero exit codes on genuine failures.

## Technology

- Prefer TypeScript.
- Use a current supported Node.js runtime.
- Keep dependencies minimal.
- Prefer libraries only when they reduce risk or boilerplate substantially.
- Do not add Electron, a database server, Ollama, browser automation, voice, or cloud APIs in M00.

## Out of Scope

M00 must NOT implement:
- Codex/Claude automatic execution,
- model quota monitoring,
- local LLM,
- voice,
- desktop overlay,
- scheduler,
- browser control,
- OS automation,
- calendar,
- finance,
- mobile.

Those follow after the bootstrap controller is proven.

## Acceptance Criteria

M00 is complete only when all of the following are objectively demonstrated:

1. A clean install/build succeeds from documented commands.
2. Required repository context can be loaded programmatically.
3. Invalid/missing state produces a clear failure.
4. Development state is validated by TypeScript types/schema.
5. At least one development task can be created/read/updated.
6. `status` reports the active milestone/task and next action.
7. `verify` runs configured verification commands and records pass/fail.
8. `checkpoint` generates a concise handoff using actual Git state.
9. Automated tests cover the critical state/context/checkpoint behavior.
10. Type checking passes.
11. Tests pass.
12. The repository is left in a state where a different coding agent could continue without explanation from the original conversation.

## Completion Output

When M00 is complete:
- update STATE.json,
- update STATE.md,
- record important architectural decisions,
- create a verified Git commit,
- push the development branch,
- produce a concise handoff including exact verification results.

Do not begin M01 automatically unless explicitly instructed by the owner or the active state/roadmap policy permits it.
