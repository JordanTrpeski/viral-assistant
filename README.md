# Jarvis

Jarvis is a local-first personal AI operating layer. Bootstrap V0 currently includes repository continuity, portable Codex/Claude development harnesses, a replaceable local reasoning layer, a durable background runtime, and a deterministic Efficiency Governor.

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
pnpm jarvis-dev harnesses
pnpm jarvis-dev packet M01-001
pnpm jarvis-dev run codex M01-001 --timeout-ms 900000
pnpm jarvis-dev run claude M01-001 --timeout-ms 900000
pnpm jarvis-dev local-status
pnpm jarvis-dev local-infer "Summarize this text" --model <installed-model>
pnpm jarvis-dev local-classify "Summarize the current project state."
pnpm jarvis-dev runtime-status
pnpm jarvis-dev runtime-start
pnpm jarvis-dev efficiency-plan M04-001
pnpm jarvis-dev efficiency-run M04-001 --timeout-ms 900000
pnpm jarvis-dev efficiency-status
```

Add `--json` to any command for script-friendly JSON output. Genuine errors return a non-zero exit code. `verify` executes the commands in `jarvis-dev.config.json` and writes structured results to `verification/latest.json`. `checkpoint` writes `CHECKPOINT.md` from current state, task, verification, and read-only Git inspection.

`harnesses` safely probes the installed Codex CLI and Claude Code. `packet` writes a concise repository-derived task packet under `packets/`. `run` launches only the explicitly selected authenticated CLI, captures bounded output and timeout diagnostics under `runs/`, links the run from `STATE.json`, and refreshes the checkpoint. Provider API-key environment variables are removed from child processes so these adapters use the CLIs' existing subscription authentication. The explicit `run` command remains available for manual provider selection. `efficiency-run` first applies the M04 owner gates and deterministic selection policy, then launches only an authorized selected harness.

The local commands use only the loopback Ollama endpoint configured in `jarvis-dev.config.json`. The validated default is `qwen3:4b-instruct`, selected as a small instruction-focused model for classification, summarization, context relevance, and routing. Configure `localBrain.preferredModel`, set the local `JARVIS_LOCAL_MODEL` environment variable, or pass `--model`. Jarvis reports missing runtime or model setup and never downloads a model automatically. Deterministic policy owns escalation decisions; local inference cannot launch a coding harness.

`runtime-start` runs the deterministic M03 service until it receives a shutdown signal. `runtime-status` reads its local task/event snapshot. Runtime applications use the exported queue API to enqueue, pause, resume, supply owner input, register handlers/conditions, and observe events. State defaults to `.viral/runtime/state.json`, which is private local data excluded from Git; `--data-dir` can select another local directory.

The efficiency commands apply configurable capability, effort, context, retry, owner-gate, and session policies. Selection always includes a concise practical reason. Operational metrics are bounded and stored locally under `.viral/efficiency/` without prompts, conversations, credentials, private owner content, or hidden reasoning. `WAITING_FOR_MODEL` resumes only after an actual availability probe succeeds.

Development tasks live in `tasks/*.json`. `STATE.json` and `STATE.md` describe current progress. A different coding agent should read `AGENTS.md`, the ordered context listed there, the active task, and `CHECKPOINT.md` before continuing.

`EFFICIENCY.md` is authoritative for model, context, reasoning-effort, escalation, session-compaction, and token/compute choices. Independent applications and major subsystems integrate through explicit, versioned connectors rather than shared databases, mutable state, or internal imports by default.

## Direct project checks

```sh
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run acceptance:m02
pnpm run acceptance:m03
pnpm run acceptance:m04
```

Bootstrap V0 currently includes development continuity, the M02 local brain, the M03 deterministic background runtime, and the M04 Efficiency Governor. It contains no cloud model API integration, voice, browser automation, desktop UI, personal data, or OS control.
