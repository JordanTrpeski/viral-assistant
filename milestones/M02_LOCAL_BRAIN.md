# M02 — Local Brain

## Objective

Give Viral a small, replaceable local reasoning layer for inexpensive classification, summarization, context selection, and routing advice without consuming cloud or coding-harness allowance. Ollama is the initial runtime. Deterministic software remains responsible for policy, state transitions, and execution.

## Boundaries

- Communicate only with an explicitly validated loopback Ollama endpoint.
- Do not add OpenAI, Anthropic, or other cloud model APIs, keys, or billing paths.
- Do not automatically install or download models.
- Do not launch Codex, Claude Code, or another harness from the local-brain layer.
- Do not let model output directly mutate repository state or enforce permissions.
- Do not add scheduling, background services, voice, browser or OS automation, UI, personal memory, or M03+ features.
- Preserve every M00 and M01 command and behavior.

## Design

### A. Provider-Neutral Local Model Contract

Define a minimal interface with a stable provider id, an availability probe, and an inference operation. The probe reports CLI installation, runtime reachability, installed model names, configured preferred model, and bounded diagnostics. Inference accepts input text, optional structured context, an optional model override, a timeout, and an optional cancellation signal. It returns timestamps, duration, selected model, output, HTTP/exit state where relevant, timeout/cancellation flags, and diagnostics without throwing for normal runtime failures.

The HTTP transport and process runner must be injectable so all behavior can be tested without a real model.

### B. Ollama Adapter

- Probe the `ollama` executable with a bounded version command.
- Probe the local runtime with `GET /api/tags`.
- List installed model names from the tags response.
- Run non-streaming generation with `POST /api/generate`.
- Default to `http://127.0.0.1:11434`; reject any configured endpoint that is not loopback.
- Use the request model override when supplied, otherwise the configured preferred model.
- Return a clear setup result when Ollama, its service, or a suitable model is unavailable.
- Never pull a model automatically.

### C. Configuration

Extend `viral-dev.config.json` with a `localBrain` object containing:

- provider (`ollama` for M02),
- loopback base URL,
- nullable preferred model,
- default timeout.

`VIRAL_LOCAL_MODEL` may override the preferred model for a local session without modifying tracked configuration. No single model name is permanent in code.

### D. Local Reasoning Tasks

Provide typed operations for:

1. request classification,
2. concise summarization,
3. context relevance selection and compact packet preparation,
4. simple routing recommendation.

Structured tasks request strict JSON and validate it. Malformed output becomes a structured failure rather than trusted data. Summaries and compact packets are bounded by normal software.

### E. Deterministic Policy

Use the escalation values:

- `LOCAL_OK`
- `CODING_HARNESS_REQUIRED`
- `OWNER_INPUT_REQUIRED`
- `UNSURE`

Deterministic rules take precedence over model recommendations for consequential owner actions and development implementation work. The model may recommend a category but cannot execute it. M02 returns recommendations only.

### F. CLI

Add small scriptable commands:

```text
viral-dev local-status [--json]
viral-dev local-infer <text> [--model <name>] [--timeout-ms <milliseconds>] [--json]
viral-dev local-classify <text> [--timeout-ms <milliseconds>] [--json]
```

The commands return non-zero for unavailable runtime/model, timeout, cancellation, malformed output, or inference failure. Existing commands remain supported.

## Automated Acceptance Criteria

1. The Ollama adapter implements the provider-neutral contract and accepts injectable process and HTTP transports.
2. Only loopback Ollama endpoints are accepted.
3. Probing distinguishes CLI installation, runtime reachability, and available models.
4. Preferred model selection is configurable and an explicit request override wins.
5. Successful inference returns a structured result.
6. Unavailable runtime, no configured/installed model, HTTP failure, malformed response, timeout, and cancellation return clean structured failures.
7. Representative requests classify as local, coding-harness escalation, or owner-input escalation according to deterministic policy.
8. Controlled local-model output reduces a large synthetic development context to a substantially smaller, relevant packet without invoking either development harness or any cloud API.
9. Malformed structured task output does not mutate state and produces `UNSURE`.
10. M00 and M01 tests remain green.
11. Typecheck, all tests, lint, and milestone-specific acceptance tests pass.

## Live Validation

Safely probe the installed Ollama CLI and loopback service. If the service and a suitable installed model are available, make one bounded, harmless inference request through the abstraction. Record the result without storing private prompts or unnecessary model output.

If Ollama or a suitable model is unavailable, report detected models and a clear owner setup step. This does not block completion of the implementation and controlled acceptance tests. Do not automatically install Ollama or download a model.

## Completion Output

- Update architecture, decisions, state, task, verification evidence, and checkpoint.
- Record live probe evidence or the exact optional setup step.
- Commit and push verified work on `dev/m02-local-brain` with the owner's GitHub identity.
- Do not merge into `main` and do not begin M03.

## Validation Record — 2026-09-10

- Typecheck, lint, all 23 automated tests, and the focused 10-test M02 acceptance command pass.
- Controlled Ollama responses demonstrate successful local abstraction queries, model selection, context use, failure handling, cancellation, and timeout behavior.
- Representative classification examples produce the required deterministic escalation categories.
- A synthetic context exceeding 50,000 characters is reduced to a relevant packet under 8,000 characters without invoking a development harness or cloud API.
- The original completion probe found no Ollama CLI, running loopback service, or installed models. Per the milestone rules at that time, optional manual installation did not block implementation completion.

## Live Validation Addendum — 2026-09-11

- With explicit owner authorization after M02 completion, Ollama 0.34.0 was installed through Ollama's official signed Windows installer and `qwen3:4b-instruct` was pulled as the configured preferred model.
- The 4.0B Q4_K_M model is approximately 2.5 GB on disk and loaded fully in the GTX 1070's 8 GB VRAM. The machine has 16 GB system RAM and a 6-core/12-thread i5-10400F; this small instruction model is sufficient for M02's structured, inexpensive tasks without installing a larger general model.
- Viral's real adapter probe reported the CLI installed, loopback service running, preferred model available, and no diagnostics.
- A live inference returned `LOCAL_READY` successfully. Real local-brain calls completed classification, summarization, relevance selection, and routing with valid structured results.
- Live summarization reduced 2,840 synthetic characters to 107. Two live relevance-selection runs reduced 7,045 synthetic characters to no more than 540 characters and selected only the two relevant sections.
- The Ollama listener was bound only to `127.0.0.1:11434`; Viral's configuration and validation continue to reject non-loopback endpoints. No cloud API, API key, or API billing path was introduced.
- The focused 10-test M02 acceptance suite and the full repository verification suite pass after live setup.
