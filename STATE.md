# Jarvis — Current Development State

M02 is in progress on `dev/m02-local-brain`. Active task: `M02-001`.

## Starting point
- M00 and M01 are complete and remain protected by their existing automated tests.
- The authenticated Codex harness and simulated Codex-to-Claude continuity are verified.
- Live Claude continuation remains optional validation when a subscription becomes available.

## M02 scope
Implement a provider-neutral local reasoning layer with an Ollama adapter, configurable model choice, safe local probes and inference, deterministic escalation policy, and controlled local tasks for classification, summarization, context selection, and routing advice.

## Blockers
None. Missing Ollama or a suitable installed model is an optional local setup step rather than an implementation blocker.

## Next action
Implement M02, run controlled acceptance tests, safely probe local Ollama availability, and record the verified result. Do not merge into main or begin M03.

Last verified prior-milestone commit: dd839409b2ae48ec879aeaaecbf69abf84e3ff4d. Repository state is the temporary Bootstrap continuity mechanism.
