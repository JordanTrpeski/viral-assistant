# Jarvis — Current Development State

M01 implementation and automated verification pass. The milestone is blocked only on completing Claude subscription authentication and the live Claude continuation. Active task: M01-001. Branch: dev/m01-multi-harness.

## Verified work
- Provider-neutral Codex and Claude adapters, bounded probes, stdin packets, structured process results, and run/checkpoint persistence.
- Codex global approval argument placement repaired and accepted by installed CLI argument parsing.
- Unknown authentication is distinguished from explicit logout; required context is validated before launch.
- Separate fake Codex and Claude executables demonstrate repository-only continuity, including reading the first harness's work and checkpoint.
- Typecheck, all tests, and lint pass. Evidence: verification/latest.json and tasks/M01-001.json.

## Live evidence
The owner-authenticated Codex probe reports `codex-cli 0.153.4`, usable through ChatGPT. The outer live run succeeded using only `packets/M01-001.md` and is recorded at `runs/20260910082604189-codex-M01-001.json`. That Codex worker inspected the repository, improved authentication-state handling and context preflight, ran verification, and produced the current checkpoint. Earlier failed invocation records are retained as diagnostics.

## Blockers
- Claude Code 2.1.266 is installed from Anthropic's official Windows x64 package. Its Claude subscription login is open and awaiting owner completion.

## Next action
Complete the open Claude subscription login. Then run `pnpm jarvis-dev run claude M01-001 --timeout-ms 600000`, verify that Claude understands the Codex handoff without prior conversation, and complete M01. Do not merge into main.

Last verified implementation commit: aeb2d29df3ca03fa4392295becab5cc1a4dc4b66. Current verification also covers the live Codex worker's uncommitted safeguards. Repository state is the temporary Bootstrap continuity mechanism.
