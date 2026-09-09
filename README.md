# Jarvis

Jarvis is a local-first personal AI operating layer. The current implementation is limited to the M00 development controller that preserves project continuity across coding-agent sessions.

## Requirements

- Node.js 22 or newer
- pnpm 11
- Git

## Clean install and build

```sh
pnpm install --frozen-lockfile
pnpm run build
```

## Development CLI

Run these from the repository root after building:

```sh
pnpm jarvis-dev context
pnpm jarvis-dev status
pnpm jarvis-dev verify
pnpm jarvis-dev checkpoint
```

Add `--json` to any command for script-friendly JSON output. Genuine errors return a non-zero exit code. `verify` executes the commands in `jarvis-dev.config.json` and writes structured results to `verification/latest.json`. `checkpoint` writes `CHECKPOINT.md` from current state, task, verification, and read-only Git inspection.

Development tasks live in `tasks/*.json`. `STATE.json` and `STATE.md` describe current progress. A different coding agent should read `AGENTS.md`, the ordered context listed there, the active task, and `CHECKPOINT.md` before continuing.

## Direct project checks

```sh
pnpm run typecheck
pnpm run test
pnpm run lint
```

M00 is intentionally limited to development continuity. It contains no AI provider integration, local model, voice, browser automation, scheduler, desktop UI, personal data, or OS control.
