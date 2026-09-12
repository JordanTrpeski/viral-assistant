export type ScopeAction = "PROCEED" | "OUT_OF_SCOPE" | "DUPLICATE";

export interface ScopeVerdict {
  inScope: boolean;
  detectedMilestone: string | null;
  reason: string;
}

export interface ScopeDecision {
  action: ScopeAction;
  reason: string;
  detectedMilestone: string | null;
  duplicateOf: string | null;
}

export interface ExistingObjective { id: string; objective: string; status: string }

// Domain keyword → milestone prefix. Deterministic, text-only; used to detect when an objective's
// content clearly belongs to a milestone other than the one it is filed under.
const domainSignatures: { prefix: string; pattern: RegExp }[] = [
  { prefix: "M06", pattern: /\b(electron|tauri|system tray|tray icon|desktop app|desktop application|viral desktop|menu ?bar app)\b/i },
  { prefix: "M05", pattern: /\b(voice|speech[- ]?to[- ]?text|text[- ]?to[- ]?speech|\bstt\b|\btts\b|whisper|piper|microphone|barge[- ]?in|voice interface|wake word)\b/i }
];

// A prior identical objective in one of these states has already been handled; re-running wastes work.
const handledStatuses = new Set(["blocked", "complete", "completed"]);

function prefixOf(milestone: string): string {
  return (milestone.split(/[_\s-]/, 1)[0] ?? milestone).toUpperCase();
}

function normalize(objective: string): string {
  return objective.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Detects the milestone an objective's content is about, or null if it is domain-neutral. */
export function detectMilestone(objective: string): string | null {
  for (const { prefix, pattern } of domainSignatures) if (pattern.test(objective)) return prefix;
  return null;
}

/**
 * Pure check: is an objective in scope for the milestone it is filed under, given the active set?
 * Out of scope when (a) the target milestone is not active, or (b) the objective's detected domain
 * belongs to a different milestone than the one it is filed under.
 */
export function isObjectiveInScope(objective: string, milestone: string, activeMilestones: string[]): ScopeVerdict {
  const active = new Set(activeMilestones.map(prefixOf));
  const target = prefixOf(milestone);
  const detected = detectMilestone(objective);
  if (!active.has(target)) {
    return { inScope: false, detectedMilestone: detected, reason: `Objective targets milestone ${milestone}, which is not in the active milestone set (${activeMilestones.join(", ") || "none"}).` };
  }
  if (detected && detected !== target) {
    const suggestion = active.has(detected) ? ` Re-submit with --milestone ${detected}.` : ` Approve and specify a ${detected} milestone before building it.`;
    return { inScope: false, detectedMilestone: detected, reason: `Objective content matches ${detected} work but is filed under ${milestone}.${suggestion}` };
  }
  return { inScope: true, detectedMilestone: detected, reason: `In scope for ${milestone}.` };
}

/** Finds a prior already-handled task with a byte-identical objective (ignoring whitespace/case). */
export function findDuplicateObjective(objective: string, existing: ExistingObjective[]): string | null {
  const target = normalize(objective);
  const match = existing.find((task) => handledStatuses.has(task.status.toLowerCase()) && normalize(task.objective) === target);
  return match?.id ?? null;
}

/**
 * Deterministic pre-launch gate. Returns DUPLICATE (already handled — do not retry), OUT_OF_SCOPE
 * (owner input required — do not spend a harness run), or PROCEED.
 */
export function evaluateScope(input: { objective: string; milestone: string; activeMilestones: string[]; existing: ExistingObjective[] }): ScopeDecision {
  const duplicateOf = findDuplicateObjective(input.objective, input.existing);
  if (duplicateOf) {
    return { action: "DUPLICATE", reason: `Blocked: duplicate of already-handled objective ${duplicateOf}; nothing has changed to resolve it, so it is not re-run.`, detectedMilestone: detectMilestone(input.objective), duplicateOf };
  }
  const scope = isObjectiveInScope(input.objective, input.milestone, input.activeMilestones);
  if (!scope.inScope) return { action: "OUT_OF_SCOPE", reason: scope.reason, detectedMilestone: scope.detectedMilestone, duplicateOf: null };
  return { action: "PROCEED", reason: scope.reason, detectedMilestone: scope.detectedMilestone, duplicateOf: null };
}
