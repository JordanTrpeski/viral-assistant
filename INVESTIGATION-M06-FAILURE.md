# Investigation — M06 "Viral Desktop" build failure

**Date:** 2026-09-12
**Objectives:** `OBJ-20260912064652626` (original), `OBJ-20260912070218517` (resubmission, the subject of this report)
**Verdict:** Not a code defect and not a harness failure. The coding agent correctly refused to build
out-of-scope work; the run "succeeded" but intentionally produced no desktop code. The real problems
are **governance ambiguity** and **missing pre-launch guards**, not a bug in Viral.

## 1. Run record — `runs/20260912070218929-claude-OBJ-20260912070218517.json`

| Field | Value |
|---|---|
| `harness` | claude |
| `succeeded` | **true** |
| `exitCode` | **0** |
| `timedOut` | false |
| `error` | null |
| `durationMs` | 185225 (~3 min) |
| `diagnostics` | `["Claude run completed.", "Exit code: 0.", "{…session init…}"]` |

The harness ran cleanly to completion. The stdout result says, in the agent's own words, that it
recognized a milestone-scope conflict, **"did not write any desktop-app code"**, re-blocked the task,
restored the blocker in `STATE.json`/`STATE.md`, ran full verification (95 tests, typecheck, lint,
M02–M04 acceptance — all pass), committed on `feat/m06-desktop`, and pushed the dev branch (no merge).

For comparison, the original `OBJ-20260912064652626` run also `succeeded=true`, `exitCode=0`,
`durationMs≈381288` (~6.4 min), task `status=blocked`, `milestone=M05_VOICE_INTERFACE`.

## 2. Extracted status

- **Succeeded:** yes (harness process exit 0, no timeout, no error).
- **Product output:** none — zero Electron/React/desktop code was written, by design.
- **Task state:** `OBJ-20260912070218517` ended `status=complete` (the finalizer committed the
  agent's governance no-op: re-block + STATE restore + checkpoint), while the original
  `OBJ-20260912064652626` is `status=blocked`. Both are tagged `milestone=M05_VOICE_INTERFACE`.

This is the key subtlety: **the harness "succeeded" while the objective was not delivered.** Exit code
0 measures "the process ran", not "the requested software was produced."

## 3. Why was it blocked as a "duplicate"?

**There is no duplicate/dedup logic in the codebase.** A repository-wide search
(`duplicate|dedup|resubmission`) finds nothing in the objective/governor/execution path;
`src/objective.ts` only marks a task `blocked` when the governor's decision is not `EXECUTE` or when
execution fails. Here the governor returned `EXECUTE / CODING_HARNESS / MEDIUM` and launched Claude.

The "duplicate" determination was made **by the coding agent inside the run**, not by Viral. Reading
`AGENTS.md`, `STATE.json`, and the active milestone spec, the agent judged the objective to be a
re-submission of the already-blocked `OBJ-20260912064652626` and recorded that in the task notes:

> "Blocked as a duplicate resubmission of OBJ-20260912064652626 … already blocked for identical
> reasons … Nothing has changed since the prior block that would resolve it … This is at least the
> fifth submission of this exact objective text across branches, all blocked for the same reason."

So "blocked as duplicate" is an **agent/governance judgment written into task notes**, not an
automated Viral mechanism.

## 4. Root cause — governance ambiguity + auto-milestone-tagging

Every reason the agent gave is legitimate and owner-level:

1. **Mis-tagged milestone.** `src/objective.ts:76` tags every objective under
   `state.currentMilestone`, which is `M05_VOICE_INTERFACE`. Desktop (M06) work therefore lands
   *inside* M05 — whose spec explicitly forbids M06+ work — and there is **no way to target M06**.
2. **M05 is not complete.** Starting a later milestone's work is owner-reserved (D017, ROADMAP,
   AGENTS Scope Discipline).
3. **No M06 spec exists.** `ls milestones/` shows **no `milestones/M06_*.md`**, so there is no
   authoritative design/boundary/verification definition — unlike every completed milestone.
4. **M06 label collision.** D025 names M06 "Viral Desktop", but `ROADMAP.md`'s M06 is
   "Desktop Control — safe Windows/OS automation." Two different projects share the M06 label.
5. **Fabricated constraints.** The objective text carries an "MVP scope, 1 hour deadline" that
   appears in no spec — an agent building to it would be inventing requirements.

A coding agent resolving any of these unilaterally (pick an M06 interpretation, build to an invented
deadline, override the M05 spec) would violate scope discipline. Declining was correct.

## 5. Real blocker, or overly defensive?

**The refusal itself is a real, correct blocker** — building would have violated the M05 spec and
AGENTS scope discipline, against an undefined and internally-conflicting M06.

**But the surrounding process is under-guarded and wasteful**, which is what makes this feel like a
"failure":

- **No deterministic pre-launch scope/dedup gate.** Viral spent a **paid coding-harness run** (here
  ~3 min; the original ~6.4 min) only for the agent to re-block. The task notes report **≥5
  submissions of the identical objective across branches** (`OBJ-20260912062649417`,
  `…062748956`, `…062813043`, `…064652626`, `…070218517`) — five harness launches, zero code. A
  cheap deterministic check ("objective is out-of-active-milestone-scope" or "byte-identical to an
  already-blocked objective") could block these **before** launching the harness.
- **Auto-milestone-tagging has no override.** There is no `--milestone` targeting, so M06 work
  cannot be filed correctly while M05 is active — it is forced into M05 and then correctly rejected.
- **Weak success signal.** `succeeded = exitCode === 0` reports success for a run that produced no
  requested output. Governance/telemetry can't distinguish "built it" from "declined and re-blocked."

So: **legitimately blocked, not overly defensive in the refusal — but the system is defensively
wasteful** because it lacks the cheap guards that would stop the repeated no-op harness runs.

## 6. What actually unblocks M06

This is an **owner decision**, not an agent one:

1. Resolve the **M06 label conflict** (D025 "Viral Desktop" vs ROADMAP "Desktop Control") and record
   the resolution in `ROADMAP.md` + `DECISIONS.md`.
2. Author an authoritative **`milestones/M06_*.md`** spec (design, boundaries, verification) — with
   real, non-fabricated constraints.
3. Decide sequencing: finish **M05 Voice Interface** first, or explicitly authorize M06 ahead of M05.
4. Provide a way to file the objective under M06 (e.g., a milestone target), so it is not auto-tagged
   into M05.

## 7. Recommended code follow-ups (optional, separate from the owner decision)

- Add a **deterministic pre-launch guard** in `OwnerObjectiveService.submit` /
  `EfficiencyGovernor.plan` that blocks an objective when (a) it is byte-identical to an existing
  blocked task, or (b) it plainly targets a milestone other than the active one — returning
  `OWNER_INPUT_REQUIRED` **without** spending a harness run.
- Add optional **milestone targeting** to `viral-dev objective` instead of always using
  `state.currentMilestone`.
- Strengthen the harness **success signal** so "process exited 0 but produced no change / re-blocked"
  is not reported as a successful objective execution.
