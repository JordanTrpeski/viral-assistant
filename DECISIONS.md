# Viral — Decision Log

## D001 — TypeScript First
**Status:** accepted

Viral core development should prefer TypeScript/JavaScript where practical.

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

This is not intended to permanently define Viral memory/state architecture. It must remain easy to replace later.

## D004 — Automatic Git Commit and Push
**Status:** accepted

Viral may automatically commit and push verified development work on appropriate development branches.

Major changes must not be merged into the stable/main branch without owner approval during the bootstrap period.

## D005 — Local-First Private Data
**Status:** accepted

Personal/private information remains local until the owner explicitly changes the policy.

## D006 — Milestone Governance
**Status:** accepted

The owner defines major milestones and acceptance outcomes.

Viral/coding agents may determine implementation subtasks and may propose roadmap changes.

## D007 — Open-Source Reuse
**Status:** accepted

Reuse mature compatible open-source code/components where it provides a real advantage and licensing/security/maintenance are acceptable.

## D008 — Deterministic Core + AI
**Status:** accepted

Viral should combine deterministic algorithms/software with AI rather than using an LLM for operations that conventional software can perform reliably.

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

## D015 — Authoritative Efficiency Policy
**Status:** accepted by owner on 2026-09-10

`EFFICIENCY.md` is authoritative for model selection, context management, reasoning effort, escalation, session compaction, and token/compute efficiency. The default order is deterministic tools, then a suitable local model, then an authenticated coding harness or cloud model when required. Capability, effort, and context should increase when evidence justifies them; efficiency remains subordinate to correctness, safety, privacy, verification, and explicit owner instructions.

This decision records policy only. The existing M02 local brain and M03 deterministic runtime remain unchanged, and no Efficiency Governor is implemented by this integration.

## D016 — Versioned Connector-First Integration
**Status:** accepted by owner on 2026-09-10

Independent applications and major subsystems should communicate through explicit, versioned connectors or interfaces. Direct database coupling, shared mutable state, and imports of another application's internals are disallowed by default because they make ownership, versioning, permissions, testing, and replacement unclear. An exception requires a strong documented technical reason and an explicit migration/compatibility plan.

This principle applies to Viral's internal and external integrations and to independent software Viral develops in the future.

## D017 — M04 Reserved for the Efficiency Governor
**Status:** accepted by owner on 2026-09-10

The authoritative efficiency policy assigns M04 to the first practical Efficiency Governor. The prior future milestones are renumbered without changing their approved scope: voice begins at M05 and remote/mobile becomes M11. This policy integration does not start or implement M04.

## D018 — Pre-M04 Development Autonomy Boundary
**Status:** accepted by owner on 2026-09-11

Within an owner-approved milestone, Viral may automatically select the appropriate development harness/model and reasoning-effort level; create implementation subtasks; checkpoint and start a fresh session when context becomes inefficient; and edit, test, checkpoint, commit, push, retry, pause, resume, and continue approved development work. Selection follows `EFFICIENCY.md`: deterministic software first, then local AI, then Codex or another stronger authenticated harness when justified. Each selection records a concise user-visible explanation of the selected harness/model, effort level, and practical reason without exposing hidden chain-of-thought.

Allowance exhaustion may move work to `WAITING_FOR_MODEL`. Viral records the earliest known reset time when available, waits through deterministic runtime logic with zero model usage, probes actual availability at or after that time, and resumes only after confirmation; timer expiry alone is not evidence of availability. Continuity is preserved through concise repository, task, and checkpoint state rather than replaying full conversations.

Switching to another paid/cloud development harness requires owner approval initially unless the owner explicitly configures automatic switching. Major changes to `PRODUCT.md`, `RULES.md`, privacy/security policy, or major roadmap direction require owner approval. Major merges into `main` require owner approval during bootstrap. Viral requests owner input when genuinely blocked, when a consequential decision is required, or when an owner-requested progress point is reached.

This decision locks the policy boundary for M04 planning. It does not implement or start M04.

## D019 — Installed M02 Local Model
**Status:** accepted operational setup on 2026-09-11

The owner authorized the remaining M02 live setup after M02 implementation. Ollama 0.34.0 was installed with Ollama's official signed Windows installer. `qwen3:4b-instruct` is the preferred local model: its 4.0B instruction-tuned Q4_K_M build is about 2.5 GB on disk, fits fully within the machine's 8 GB GTX 1070 VRAM, and is appropriately sized for classification, concise summarization, relevance selection, and simple routing. The machine also has 16 GB system RAM and a 6-core/12-thread i5-10400F, so a larger general model is unnecessary for these tasks.

Viral continues to accept only an explicitly validated loopback Ollama base URL. Live validation used `http://127.0.0.1:11434`, whose listener was bound only to `127.0.0.1`; no cloud model API, API key, or API billing path was added. Model installation is an owner-authorized setup action outside the local-brain adapter, which still never pulls models automatically.

## D020 — Deterministic Efficiency Governor and Private Operational Telemetry
**Status:** accepted for M04

M04 implements `EFFICIENCY.md` through a small provider-neutral governor whose inputs are explicit task, risk, availability, failure, context, and permission facts. Deterministic software selects the capability tier, LOW/MEDIUM/HIGH effort, owner gate, retry/wait action, context budget, and fresh-session recommendation. Local-model output may compress already-filtered context but cannot authorize actions or own state transitions.

The configured primary harness is Codex. Alternate paid/cloud harness switching remains disabled unless the owner approves the specific switch or explicitly enables automatic switching. Governed execution must plan before launch, propagate the selection where the provider supports it, and persist the concise user-visible selection record. Unavailable capability enters `WAITING_FOR_MODEL`; reaching a stored retry time only permits a real availability probe and does not imply success.

Efficiency telemetry uses a replaceable bounded JSON store under `.viral/efficiency/`. It may record capability/provider selection, effort, practical reason, context budget and size, waits, escalation, session reset, outcome, and latency. It must not record prompts, conversation history, credentials, owner-private content, or hidden reasoning. This local telemetry is operational evidence rather than project source of truth.

## D021 — Viral Is the Canonical Product and CLI Name
**Status:** accepted by owner on 2026-09-11

The active product, npm package, executable, configuration, environment variables, source diagnostics, tests, and maintained documentation use Viral. The canonical package is `viral-development-controller`, the CLI and npm script are `viral-dev`, and its configuration is `viral-dev.config.json`. No compatibility alias is retained because the bootstrap CLI has no external stable consumers recorded in the repository.

Git branches, commit history, the GitHub repository URL, and `.viral/` storage are unchanged. The legacy name `Jarvis` remains only in this decision and in `runs/20260910082604189-codex-M01-001.json`, whose captured M01 process output is preserved as immutable historical diagnostic evidence rather than rewritten.
