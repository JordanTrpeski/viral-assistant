# Jarvis — Current Development State

M01 is complete and verified on `dev/m01-multi-harness`. No task is active.

## Verified work
- Provider-neutral Codex and Claude adapters, bounded probes, stdin packets, structured process results, and run/checkpoint persistence.
- Codex global approval argument placement repaired and accepted by installed CLI argument parsing.
- Unknown authentication is distinguished from explicit logout; required context is validated before launch.
- Separate fake Codex and Claude executables demonstrate repository-only continuity, including reading the first harness's work and checkpoint.
- The owner-authenticated live Codex harness completed successfully from a generated repository packet and persisted its run record and handoff.
- Typecheck, 13 tests, and lint pass. Evidence: verification/latest.json and tasks/M01-001.json.

## Live evidence
The owner-authenticated Codex probe reports `codex-cli 0.153.4`, usable through ChatGPT. The outer live run succeeded using only `packets/M01-001.md` and is recorded at `runs/20260910082604189-codex-M01-001.json`. That Codex worker inspected the repository, improved authentication-state handling and context preflight, ran verification, and produced the current checkpoint. Earlier failed invocation records are retained as diagnostics.

## Deferred optional validation
Claude Code 2.1.266 is installed, but a Claude Code subscription is not currently available. Per owner direction, live Claude authentication and continuation do not block M01. When subscription access becomes available, run `pnpm jarvis-dev run claude M01-001 --timeout-ms 600000` and confirm it understands the stored Codex handoff without prior conversation.

## Blockers
None.

## Next action
Await owner direction. Do not start M02 or merge into main without owner approval.

Last verified implementation commit: dd839409b2ae48ec879aeaaecbf69abf84e3ff4d. Repository state is the temporary Bootstrap continuity mechanism.
