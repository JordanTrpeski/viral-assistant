# Jarvis — Decision Log

## D001 — TypeScript First
**Status:** accepted

Jarvis core development should prefer TypeScript/JavaScript where practical.

Python or other languages remain allowed when they provide a concrete technical advantage.

## D002 — Authenticated Coding Harnesses
**Status:** accepted

Initial self-development should use the owner's authenticated:
- Codex CLI account/session,
- Claude Code account/session.

Do not default development work to OpenAI API or Anthropic API billing.

## D003 — Repository State Is Bootstrap-Only
**Status:** accepted, explicitly revisitable

During Bootstrap V0, repository state files provide development continuity between coding agents.

This is not intended to permanently define Jarvis memory/state architecture. It must remain easy to replace later.

## D004 — Automatic Git Commit and Push
**Status:** accepted

Jarvis may automatically commit and push verified development work on appropriate development branches.

Major changes must not be merged into the stable/main branch without owner approval during the bootstrap period.

## D005 — Local-First Private Data
**Status:** accepted

Personal/private information remains local until the owner explicitly changes the policy.

## D006 — Milestone Governance
**Status:** accepted

The owner defines major milestones and acceptance outcomes.

Jarvis/coding agents may determine implementation subtasks and may propose roadmap changes.

## D007 — Open-Source Reuse
**Status:** accepted

Reuse mature compatible open-source code/components where it provides a real advantage and licensing/security/maintenance are acceptable.

## D008 — Deterministic Core + AI
**Status:** accepted

Jarvis should combine deterministic algorithms/software with AI rather than using an LLM for operations that conventional software can perform reliably.

## D009 — Dependency-Light Bootstrap Controller
**Status:** accepted

M00 uses Node.js, TypeScript, built-in runtime modules, and repository-visible JSON/Markdown files. Runtime schema checks are implemented locally rather than adding a schema framework. This keeps the replaceable bootstrap controller small while still failing clearly on malformed input.
