# Jarvis — Current Development State

M03 is in progress on `dev/m03-background-runtime`. Active task: `M03-001`.

## Starting point
- M00–M02 are complete and protected by their automated tests.
- The local-brain layer remains optional at runtime; Ollama is not installed on this machine.
- The repository working tree was clean at M03 start.

## M03 scope
Implement a durable deterministic background service with an embedded replaceable store, task queue, one-time and recurring schedules, condition/model/owner waits, pause/resume, bounded retries, simple dependencies, internal events, and safe restart recovery.

## Blockers
None.

## Next action
Implement M03 and its restart-oriented acceptance tests. Do not merge into main or begin M04.

Last verified prior-milestone commit: b63cb75426e5b634ab3b155aed1f7c8986bd8d13. Repository state is the temporary Bootstrap continuity mechanism.
