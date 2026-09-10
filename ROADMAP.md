# Jarvis — Roadmap

The roadmap defines major direction. Jarvis may create and reorder implementation subtasks inside an active milestone when doing so is necessary to satisfy that milestone. Major roadmap changes require owner approval.

## M00 — Bootstrap Self-Development Core
Build the smallest reliable controller that understands Jarvis's product/rules/state and can coordinate verified development work.

Detailed specification: `milestones/M00_BOOTSTRAP.md`

## M01 — Codex ↔ Claude Code Development Portability
Prove that a partially completed development task can move between authenticated Codex CLI and Claude Code sessions without manual re-explanation.

Detailed specification will be refined after M00.

## M02 — Local Brain
Integrate a small local LLM runtime, initially likely through Ollama, for cheap classification, summarization, routing support, context selection, and simple planning.

Detailed specification: `milestones/M02_LOCAL_BRAIN.md`

## M03 — Background Runtime and Scheduler
Run Jarvis continuously as a background process with durable scheduled tasks, condition waits, resumable work, notifications, and owner-input states.

## M04 — Voice Interface
Add local-first speech recognition and text-to-speech, plus push-to-talk/hotkey interaction. Wake-word support may follow if justified.

## M05 — Desktop Control
Add safe Windows/OS automation through a permissioned tool layer.

## M06 — Browser Automation
Add isolated autonomous browsing and, where safe, controlled use of the owner's authenticated browser session.

## M07 — Persistent Personal Memory
Introduce a local, structured memory system for goals, projects, routines, tasks, preferences, and relevant history. Revisit/replace Bootstrap repository state where appropriate.

## M08 — Life Modules
Incrementally add owner-approved modules such as:
- calendar,
- workout planning,
- day planning,
- finances/budgeting,
- travel/hotel research,
- shopping,
- communication.

## M09 — Desktop Experience
Create the full desktop control center, overlay, system tray experience, token/quota visibility, progress views, permissions, and settings.

## M10 — Remote/Mobile Interface
Provide a limited mobile/remote interface while the PC remains the primary execution environment. Optional relay/server components may be evaluated later.

## Roadmap Rule

Do not implement a later milestone merely because it is interesting. Complete and verify the active milestone first unless the owner explicitly changes priorities.
