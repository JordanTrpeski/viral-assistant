# Jarvis — Current Development State

M02 is complete and verified on `dev/m02-local-brain`. No task is active.

## Verified work
- A provider-neutral local-model contract and injectable Ollama adapter support installation/runtime/model probes and structured inference.
- Loopback validation prevents remote model endpoints; no cloud SDK or API path was added.
- Model choice is configurable through repository configuration, `JARVIS_LOCAL_MODEL`, or a request override.
- Inference handles structured context, timeout, cancellation, unavailable service, HTTP failure, and malformed responses without changing project state.
- Local classification, summarization, context relevance selection, and routing recommendation tasks are available.
- Deterministic policy produces all four escalation results and prevents model output from launching a coding harness or controlling state transitions.
- The synthetic context acceptance test reduces more than 50,000 characters to a relevant packet under 8,000 characters without a cloud or coding-harness call.
- Typecheck, lint, all 23 tests, and the 10-test M02 acceptance command pass. M00 and M01 coverage remains green.

## Live probe
The safe probe found no Ollama CLI, running loopback service, or installed models. Available installed model options: none. This is the documented non-blocking setup case for M02.

Optional setup: install Ollama, choose and manually pull a suitably small model, then set `localBrain.preferredModel` in `jarvis-dev.config.json` or set `JARVIS_LOCAL_MODEL`. Run `pnpm jarvis-dev local-status`, followed by a bounded `local-infer` request. Viral does not install Ollama or download models automatically.

## Blockers
None.

## Next action
Await owner direction. Do not merge into main or begin M03 without owner approval.

Last verified implementation commit: b63cb75426e5b634ab3b155aed1f7c8986bd8d13. Repository state is the temporary Bootstrap continuity mechanism.
