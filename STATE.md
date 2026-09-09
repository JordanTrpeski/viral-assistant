# Jarvis — Current Development State

## Current Milestone
M01 — Codex ↔ Claude Code Development Portability

## Status
In progress on `dev/m01-multi-harness`.

## Completed
- Product direction defined.
- Initial engineering principles defined.
- Bootstrap rules defined.
- Initial roadmap defined.
- Private remote selected as `JordanTrpeski/viral-assistant`.
- TypeScript context and state validation implemented.
- Repository-visible task persistence implemented and tested for create/read/update.
- Structured verification runner implemented.
- Read-only Git inspection and deterministic checkpoint generation implemented.
- Scriptable `context`, `status`, `verify`, and `checkpoint` commands implemented.
- Clean install/build, 7 automated tests, type checking, and lint all pass.

## Current Work
Implementing provider-neutral Codex CLI and Claude Code harnesses, concise task packets, structured process results, and repository-based handoff continuity.

## Next Action
Implement the M01 specification and automated portability tests. Run the live Codex-to-Claude handoff when both authenticated CLIs are usable.

## Blockers
- Claude Code is not installed or discoverable. This blocks only the final live cross-provider acceptance test; adapter implementation can continue with controlled test executables.

## Last Verified Commit
`aca9d3768fccb88434d188addeeca132c7669930`

## Verification
- `pnpm install --frozen-lockfile`: passed
- `pnpm run build`: passed
- `pnpm run typecheck`: passed
- `pnpm run test`: 7 passed, 0 failed
- `pnpm run lint`: passed
- CLI context/status/checkpoint commands: passed
- CLI genuine-failure exit check: returned exit code 1 as required

## Important Note
This repository-state mechanism is intentionally temporary and may be revisited once Jarvis has a proper local state/memory subsystem.
