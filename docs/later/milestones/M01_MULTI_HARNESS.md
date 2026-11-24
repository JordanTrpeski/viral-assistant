# M01 — Codex ↔ Claude Code Development Portability

## Objective

Build the smallest provider-neutral development-harness layer that can launch repository-scoped work through the owner's authenticated Codex CLI or Claude Code subscription and preserve enough repository state for the other harness to continue without prior chat history.

## Boundaries

- Use installed command-line tools and their existing interactive/subscription authentication only.
- Never read, copy, persist, log, or request authentication tokens or API keys.
- Do not call OpenAI or Anthropic APIs directly.
- Do not choose a harness automatically.
- Do not bypass either CLI's sandbox or permission controls.
- Keep the adapters replaceable and keep provider-specific arguments inside each adapter.
- Do not implement M02 or later features: no local model, voice, browser or OS automation, UI, scheduler, quota routing, calendar, finance, or personal data.

## Required Capabilities

### A. Provider-Neutral Harness Contract

Define a small interface with:

- stable harness id and display name,
- an availability/usability probe,
- a launch operation accepting a repository root, task packet, and timeout,
- a structured result containing timestamps, duration, exit state, timeout state, stdout, stderr, and diagnostics.

Process execution must be injectable so adapters can be tested without launching real models.

### B. Codex CLI Adapter

Use `codex exec` in non-interactive mode, pass the task packet through standard input, set the repository root explicitly, retain the CLI's normal workspace sandbox, and request structured output. Do not use API configuration, `--oss`, or dangerous bypass flags.

### C. Claude Code Adapter

Use `claude --print` in non-interactive mode, pass the task packet through standard input, run in the repository root, and request structured streaming output. Do not use API-key configuration or dangerous permission bypass flags.

### D. Safe Probing

Probe installation with a bounded `--version` process. Where supported, probe authentication with the CLI's status command. Report `usable: null` when authentication cannot be determined safely. Missing executables and timeouts must be normal structured results rather than uncaught process errors.

### E. Concise Task Packet

Generate a deterministic Markdown packet from repository-visible data:

- selected task and acceptance criteria,
- current milestone status, blockers, and next action,
- branch, HEAD, and changed files,
- latest verification summary,
- last harness-run summary when present,
- exact repository documents and task files the receiving agent must read,
- constraints prohibiting secrets, direct APIs, future milestones, unauthorized merges, and reliance on previous conversation.

Write the packet under `packets/`. Do not include full conversation history or copy entire context documents into it.

### F. Launch and Continuity Records

Expose explicit CLI commands to list harness status, prepare a packet, and launch a selected harness. Each launch must:

1. validate the selected task and context,
2. generate the packet,
3. invoke only the explicitly selected adapter,
4. capture a structured result under `runs/`,
5. update the repository state with the run record path,
6. refresh the checkpoint after the process exits, including failures and timeouts.

The result files must contain no credentials and must remain useful if the originating model session disappears.

## CLI Shape

```text
viral-dev harnesses [--json]
viral-dev packet [task-id] [--json]
viral-dev run <codex|claude> [task-id] [--timeout-ms <milliseconds>] [--json]
```

Existing M00 commands remain supported.

## Automated Acceptance Criteria

1. A provider-neutral interface is implemented and both adapters conform to it.
2. Codex arguments use non-interactive `exec`, stdin packets, explicit repository root, and a workspace sandbox without bypass flags.
3. Claude arguments use non-interactive print mode, stdin packets, structured output, and no bypass flags.
4. Missing executables, authentication failures, non-zero exits, and timeouts produce structured diagnostics.
5. Probes are bounded and distinguish installed from usable when possible.
6. Packets are deterministic, concise, based on current repository state, and contain no conversation history.
7. The selected harness receives the generated packet unchanged.
8. Run results are persisted and linked from state; checkpoints summarize the latest run.
9. Tests simulate a Codex-start → checkpoint → Claude-continue sequence using separate fake executables and prove the second harness receives sufficient repository/task context without the first harness's conversation.
10. Existing M00 tests continue to pass.
11. Type checking, all tests, and lint pass.
12. Scriptable CLI commands return non-zero on genuine launch/probe failures.

## Live Validation

The required live validation for M01 is:

1. `harnesses` reports Codex installed and usable through ChatGPT subscription authentication.
2. Start a repository development task through the Codex adapter using only its generated packet.
3. Persist the Codex result and generate a checkpoint/handoff.

The following Claude continuation is useful future validation when the owner has a Claude Code subscription, but it does not block M01 completion:

1. Authenticate Claude Code with the owner's subscription.
2. Launch Claude on the same task using only the repository state and newly generated packet.
3. Confirm Claude correctly identifies the completed work, current Git state, acceptance criteria, and next action without any manual explanation of the Codex conversation.

Per owner direction on 2026-09-10, the implemented Claude adapter plus the separate-process simulated Codex-to-Claude continuity test objectively cover the implementation requirement until subscription access is available.

## Completion Output

- Update `STATE.json`, `STATE.md`, `DECISIONS.md`, and the active task.
- Retain structured verification and harness-run evidence.
- Generate a concise checkpoint.
- Create verified commits and push `dev/m01-multi-harness` using the owner's GitHub identity.
- Do not merge into `main` and do not begin M02.
