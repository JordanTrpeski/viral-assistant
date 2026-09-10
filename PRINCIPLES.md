# Jarvis — Engineering and Product Principles

1. **Local first**
   Personal information, credentials, private memories, financial information, calendar data, voice data, browser session data, and other user-specific data remain local by default until the owner explicitly changes that policy.

2. **TypeScript first**
   Prefer TypeScript/JavaScript for the core system when practical. Other languages may be used when they provide a clear technical advantage.

3. **Repository continuity during bootstrap**
   During Bootstrap V0, the repository is the development continuity mechanism. This is intentionally replaceable and may later move to a local database or another state system.

4. **Model independence**
   No single LLM, coding agent, chat session, or vendor may become the source of truth for development progress.

5. **Deterministic software before LLM reasoning**
   Scheduling, Git operations, state transitions, test execution, quota timers, permissions, and other deterministic operations should be implemented as normal software where practical.

6. **Spend intelligence where it matters**
   Use local or cheaper computation for routine work. Escalate to stronger cloud models only when the expected value justifies it.

7. **Context is a managed resource**
   Do not carry large conversation histories when a concise checkpoint or relevant subset of context is sufficient.

8. **Reuse before rebuild**
   Before implementing a substantial subsystem, inspect mature compatible open-source alternatives. Reuse, wrap, adapt, or selectively port them when licensing, maintainability, security, and architectural fit are acceptable.

9. **Modular and replaceable**
   Important integrations must be behind interfaces/adapters so individual models, runtimes, browser engines, voice systems, memory stores, and other components can be replaced.

10. **Verify, do not assume**
    A coding agent stating that something works is not proof. Use executable tests, static checks, integration checks, or explicit acceptance checks.

11. **Reversible self-development**
    Self-modification must be checkpointed in Git and should be recoverable.

12. **Owner attention is expensive**
    Jarvis should avoid unnecessary interruptions. Ask when required, not merely because asking is easier.

13. **Prefer understandable systems**
    Avoid unnecessary framework complexity. Bootstrap components should remain small enough that another coding agent can understand and repair them.

14. **Efficiency serves verified completion**
    Follow `EFFICIENCY.md` for model, context, reasoning-effort, escalation, session-compaction, and token/compute decisions. Use deterministic tools before local models and local models before cloud capability when each can complete the work reliably. Escalate when evidence warrants it, and never trade away correctness, safety, privacy, or verification merely to reduce usage.

15. **Connector-first integration**
    Independent applications and major subsystems should communicate through explicit, versioned connectors or interfaces. Avoid direct database coupling, shared mutable state, and importing another application's internals unless a strong reason is documented. Viral applies this principle to its own architecture and to software it develops in the future.
