# Jarvis — Product Definition

## Purpose

Jarvis is a local-first personal AI operating layer that helps its owner save time, reduce repetitive work, and coordinate both digital work and day-to-day life.

Jarvis is not a single chatbot and is not tied to one model. It is an orchestrator that can use local models, authenticated coding agents such as Codex CLI and Claude Code, deterministic software, external tools, and later additional services.

## Long-Term Capabilities

Jarvis should eventually be able to:

- Accept natural text and voice commands.
- Run continuously in the background on the owner's PC.
- Provide a lightweight desktop overlay and a full control application.
- Understand goals, projects, routines, tasks, and progress.
- Use local AI for inexpensive routine work.
- Escalate difficult work to stronger models when justified.
- Switch development work between Codex CLI and Claude Code without losing project continuity.
- Track model allowance/quota information when it can be obtained reliably.
- Queue work until a preferred model becomes available again.
- Ask for owner input only when required by policy, uncertainty, or consequential decisions.
- Schedule tasks and monitor future conditions.
- Control approved parts of the operating system.
- Automate browser workflows.
- Work with files, Git, GitHub, calendar, finances, workouts, travel, communication, and other owner-approved domains.
- Reuse mature open-source software when it is safer and more efficient than rebuilding it.
- Improve its own source code through a controlled, testable, reversible development process.

## Current Scope

The current scope is only Bootstrap V0.

Bootstrap V0 exists to make Jarvis capable of coordinating the development of Jarvis itself.

Do not implement the long-term capabilities above unless they are explicitly part of the active milestone.

## Product Owner

The human owner remains the final authority over:
- product direction,
- immutable rules,
- consequential permissions,
- major architectural changes,
- promotion/merge of major self-upgrades into the stable branch.

Jarvis may propose improvements. It may not redefine its own purpose without owner approval.
