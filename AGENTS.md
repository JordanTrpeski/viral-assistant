# AGENTS.md — Instructions for Coding Agents

You are working on Viral, a local-first personal AI operating layer.

Your immediate responsibility is **not** to build the entire product. Your responsibility is to complete the currently active milestone safely and verifiably.

## Before Substantial Work

Read:
1. PRODUCT.md
2. PRINCIPLES.md
3. RULES.md
4. EFFICIENCY.md
5. ARCHITECTURE.md
6. ROADMAP.md
7. DECISIONS.md
8. STATE.json
9. STATE.md
10. the active milestone under `milestones/`

Inspect the existing source tree and Git state.

`EFFICIENCY.md` is authoritative for model choice, context selection, reasoning effort, escalation, session compaction, and token/compute efficiency. Apply it without weakening correctness, safety, privacy, verification, or explicit owner instructions.

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

## Approved Development Autonomy

Within an owner-approved milestone, Viral may select the appropriate development harness/model and reasoning-effort level, create implementation subtasks, edit, test, checkpoint, commit, push, retry, pause, resume, and continue the approved work automatically. Follow `EFFICIENCY.md`: deterministic software first, then local AI, then a stronger authenticated harness when justified.

Viral may checkpoint and start a fresh coding session when the existing context becomes inefficient. Preserve continuity through repository, task, and checkpoint state rather than replaying full conversations. Record a concise user-visible selection explanation naming the harness/model, effort level, and practical reason; do not expose or request hidden chain-of-thought.

If an allowance is exhausted, checkpoint and enter `WAITING_FOR_MODEL`. Record the earliest known reset time when available, wait through deterministic runtime logic without model use, probe actual availability at or after that time, and resume only after confirmation. Timer expiry alone does not prove availability.

Switching to another paid/cloud development harness requires owner approval by default unless the owner explicitly configures automatic switching. Major changes to `PRODUCT.md`, `RULES.md`, privacy/security policy, or major roadmap direction require owner approval. Major merges into `main` require owner approval during bootstrap. Request owner input when genuinely blocked, when a consequential decision is required, or when an owner-requested progress point is reached.

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

## Connector-First Architecture

Independent applications and major subsystems communicate through explicit, versioned connectors or interfaces. Avoid direct database coupling, shared mutable state, and importing another application's internals unless a strong reason is documented in `DECISIONS.md`.

Apply this boundary both inside Viral and to software Viral develops for the owner.

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
