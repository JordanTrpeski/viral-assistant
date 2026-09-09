# AGENTS.md — Instructions for Coding Agents

You are working on Jarvis, a local-first personal AI operating layer.

Your immediate responsibility is **not** to build the entire product. Your responsibility is to complete the currently active milestone safely and verifiably.

## Before Substantial Work

Read:
1. PRODUCT.md
2. PRINCIPLES.md
3. RULES.md
4. ARCHITECTURE.md
5. ROADMAP.md
6. DECISIONS.md
7. STATE.json
8. STATE.md
9. the active milestone under `milestones/`

Inspect the existing source tree and Git state.

## Working Method

1. Determine the smallest coherent next step toward the active milestone.
2. Create/update implementation tasks as needed.
3. Implement only what is required for the active milestone.
4. Add/update tests.
5. Run relevant verification.
6. If verification fails, diagnose and repair before declaring success.
7. When a meaningful verified checkpoint is reached:
   - update development state,
   - create a clear Git commit,
   - push the permitted development branch.
8. Keep the working tree and handoff understandable for another coding agent.

## Cross-Model Continuity

Assume your session may end unexpectedly.

Do not rely on hidden conversation context for critical project knowledge.

Before ending meaningful work, ensure another agent could continue by reading:
- repository docs,
- state,
- active task/checkpoint data,
- Git status/log/diff,
- tests and diagnostics.

Keep handoffs concise. Do not dump full conversation histories into the repository.

## Scope Discipline

Do not build voice, browser control, calendar, finance, desktop UI, local LLM support, or other future features unless the active milestone explicitly requires them.

## Open-Source Policy

For substantial subsystems, prefer evaluating existing compatible open-source implementations before rebuilding them.

Do not import unnecessary frameworks or large repositories merely because they exist.

## Architecture Changes

You may make implementation-level architectural decisions needed for the active milestone.

If a change materially alters:
- product direction,
- owner-controlled permissions,
- privacy policy,
- stable architecture boundaries,
- milestone ordering,

record a proposal and require owner approval rather than silently applying it.

## Completion Standard

A milestone is complete only when its acceptance criteria are objectively demonstrated.

"Implemented" is not equivalent to "verified."

## Owner Git Identity

Always commit and push using the owner's GitHub account, JordanTrpeski.
Use author name Jordan Trpeski and email 102552864+JordanTrpeski@users.noreply.github.com.
Verify the push authentication belongs to this account before publishing. Do not substitute an agent identity or another account.
