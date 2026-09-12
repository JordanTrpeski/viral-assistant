# M06 — Viral Desktop

## Status

Active. Opened by owner approval **D025** (2026-09-12); the owner switched the current milestone to
M06 with M05 Voice Interface paused (not abandoned). This document is the authoritative M06 spec.

## Objective

Build an Electron + React desktop application called **Viral Desktop** (MVP scope) that front-ends the
governed objective workflow. The owner types objectives; Viral asks clarifying questions iteratively in
chat, the owner answers, and Viral executes and shows progress live.

## Required Design

### A. Application shell
- Electron + React desktop app, 900x600 resizable window, dark theme with cyan/purple accents.
- System tray: left-click toggles the window; right-click opens a menu. Auto-start on Windows.
- Styling with Tailwind CSS.

### B. Chat / objective flow
- Central chat where the owner enters an objective and answers clarifying questions iteratively.
- Viral executes the governed objective and streams progress live.

### C. Left sidebar — task queue
- Task queue with realtime updates (queued / running / completed / failed).

### D. Right sidebar — diagnostic panel (collapsible)
- Task progress %, token usage, system health, recent logs, and errors.

### E. Backend wiring
- A local HTTP daemon server plus a WebSocket channel for realtime UI updates.
- The UI talks to the existing governed objective/runtime layer through this local server.

## Deliverable
- A working application: `npm run desktop:dev` launches it.
- Tests for the chat flow, the task queue, and the diagnostics panel.

## Boundaries
- Preserve all M00–M04 behavior; do not regress the governor, runtime, finalizer, scope guard, or CLI.
- Local-first: no OpenAI/Anthropic or other cloud APIs, keys, or API billing.
- Do not bypass harness sandbox, authentication, or permission controls.
- Merges into `main` and major product/rules/privacy/security/roadmap-direction changes remain owner-gated.
- UI tests must be deterministic and must not require a running Electron display or network access; the
  server/UI logic is exercised through injectable interfaces and fakes.

## Verification
- The full repository test suite, the M02–M04 acceptance suites, and lint continue to pass.
- New tests cover the chat flow, task-queue updates, and the diagnostics panel deterministically.

## Owner approval
- D025 — Owner Approval to Open M06 Viral Desktop (2026-09-12). Blocking constraints: none.
