# M05 — Voice Interface

## Objective

Add a local-first voice interface CLI to Viral: local speech-to-text (Whisper), local text-to-speech
(Piper), 16kHz mono audio, a 2s silence timeout, interrupt (barge-in) support, and a
`viral-dev voice listen --timeout <duration>` command, with tests. Opened by owner approval D024.

## Boundaries

- Preserve all M00–M04 behavior; do not regress the governor, runtime, finalizer, or existing CLI.
- Local-first only: no OpenAI/Anthropic or other cloud APIs, keys, or API billing; no cloud STT/TTS.
- Do not bypass harness sandbox, authentication, or permission controls.
- Major changes to product/rules/privacy/security/roadmap direction and merges into `main` remain owner-gated.
- Tests must be deterministic and must not require network access or installed audio engines (Whisper,
  Piper, microphone). The audio/STT/TTS pipeline is abstracted behind injectable interfaces so tests
  exercise the CLI and orchestration with fakes.
- Do not begin M06+ work (desktop control, browser automation, memory, life modules).

## Required Design

### A. Voice pipeline contracts (provider-neutral, injectable)

- A speech-to-text port (default adapter: local Whisper) that transcribes 16kHz mono audio frames.
- A text-to-speech port (default adapter: local Piper) that synthesizes a response to audio output.
- An audio capture/playback port with a configurable silence timeout (default 2s) and interrupt
  (barge-in) support that stops playback when new speech is detected.
- Real adapters shell out to locally installed engines and are constructed at the edge; the core logic
  depends only on the ports so it is testable with fakes.

### B. CLI command

- `viral-dev voice listen [--timeout <duration>]` (e.g. `--timeout 30s`) starts a listen→transcribe→
  respond loop using the ports, honoring the silence timeout and interrupt support.
- Durations parse human forms (`30s`, `2s`, `500ms`); invalid input fails with a clear error.
- `--json` emits structured turn records; genuine errors exit non-zero.

### C. Configuration

- Voice settings (sample rate, silence timeout, STT/TTS engine paths/models) live in
  `viral-dev.config.json` under a `voice` section with validation and sensible defaults
  (16kHz mono, 2s timeout).

### D. Tests

- Unit tests for duration parsing, the listen loop over fake STT/TTS/audio ports (silence timeout ends
  a turn; interrupt stops playback), and config validation. No real audio engines or network required.

## Verification

`pnpm run test`, `pnpm run typecheck`, `pnpm run lint`, and the M02–M04 acceptance suites must all pass,
with new voice tests added and green.
