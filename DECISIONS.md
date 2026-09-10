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

## D010 — CLI Harness Boundary and Repository Handoffs
**Status:** accepted

Codex CLI and Claude Code are integrated through one small process-based interface with provider-specific arguments isolated in adapters. Viral passes concise repository-derived packets over standard input and persists bounded, redacted run results. It does not copy chat history, select models automatically, bypass permission controls, or use provider APIs.

Subscription use is enforced defensively by removing common OpenAI and Anthropic API-key and alternate-endpoint environment variables from harness child processes. The installed CLIs retain responsibility for their own secure OAuth/subscription credentials.

### D010 implementation clarification
Authentication status remains unknown when the CLI cannot access its home, times out, or returns unsupported status output. A successful version probe alone does not establish subscription usability. Required project context is loaded before launching a selected harness. Live validation requirements follow the active milestone and later explicit owner decisions.

## D011 — Defer Live Claude Validation
**Status:** accepted by owner on 2026-09-10

M01 completion requires the implemented Claude adapter, separate-process simulated Codex-to-Claude continuity, and a successful owner-authenticated live Codex run. Live Claude authentication and continuation are deferred optional validation because a Claude Code subscription is not currently available. This deferral does not weaken the adapter or automated continuity acceptance criteria and does not authorize M02 work.

## D012 — Loopback Ollama Local-Brain Boundary
**Status:** accepted for M02

M02 uses Ollama through a small provider-neutral local-model interface. The initial adapter accepts only loopback HTTP(S) endpoints, uses a configurable preferred model, and never downloads a model automatically. This keeps inference local and makes the runtime replaceable without introducing a cloud SDK or API billing path.

Local inference may classify, summarize, select context, and recommend routing. Deterministic software validates and bounds its output, owns escalation policy and state transitions, and must separately authorize any action. The M02 local brain cannot launch Codex, Claude Code, or another development harness.

## D013 — Atomic Local Runtime Snapshots
**Status:** accepted for M03

M03 persists its queue and internal event history through a replaceable `RuntimeStore`. The initial store is an atomic JSON snapshot under `.viral/runtime/`, which is local and excluded from Git. This avoids an external database service and new runtime dependencies for the small Bootstrap queue. A later persistence adapter may replace it without changing scheduling or handler contracts.

One background service owns a runtime directory in M03. Startup requeues interrupted `RUNNING` and `VERIFYING` tasks, so execution after an interruption is at least once. Handlers that perform consequential side effects must be idempotent. Multi-process coordination, exactly-once distributed execution, cron/calendar semantics, and the future personal-memory store remain outside M03.

## D014 — Deterministic Runtime Owns Waiting and State
**Status:** accepted for M03

The runtime engine, rather than an LLM, owns task states, scheduling, fixed-interval recurrence, dependencies, retry limits, owner-input gates, and event generation. Conditions and task handlers are modular adapters. A waiting task invokes neither a handler nor model inference until an ordinary software condition or explicit owner response makes it runnable. The model-availability condition uses only the M02 probe and cannot launch a model or coding harness.
