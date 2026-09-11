import type { DevelopmentTask } from "../types.js";
import type { EfficiencyConfig, SessionPlan, SessionState } from "./types.js";

export type FreshSessionThresholds = Pick<EfficiencyConfig, "freshSessionCharacters" | "freshSessionCompletedRatio" | "freshSessionNoiseRatio">;

function bullets(values: string[]): string[] { return values.length ? values.map((value) => `- ${value}`) : ["- None"]; }
function ratio(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
  return value;
}

const completedMarker = /\b(complete|completed|finaliz(?:e|ed)|verified|pushed|done)\b/i;
const noiseMarker = /\b(fail|failed|failure|error|blocked|retry|diagnostic|timed out|unavailable)\b/i;

/**
 * Deterministically derives the session-context signals the governor uses to decide whether a fresh
 * session is warranted. Uses only durable task state (objective, acceptance, relevant files, notes) so
 * a task that has accumulated a large or completion/noise-heavy history is recognized without replaying
 * any conversation.
 */
export function deriveSessionMetrics(task: DevelopmentTask): { contextCharacters: number; completedContextRatio: number; contextNoiseRatio: number } {
  const notes = task.notes ?? [];
  const contextCharacters = [task.objective, ...task.acceptanceCriteria, ...task.relevantFiles, ...notes].join("\n").length;
  const denominator = notes.length || 1;
  const completed = notes.filter((note) => completedMarker.test(note)).length;
  const noise = notes.filter((note) => noiseMarker.test(note)).length;
  return {
    contextCharacters,
    completedContextRatio: notes.length ? completed / denominator : 0,
    contextNoiseRatio: notes.length ? noise / denominator : 0
  };
}

export class EfficiencySessionPlanner {
  constructor(private readonly config: FreshSessionThresholds) {}
  plan(state: SessionState): SessionPlan {
    if (!state.objective.trim() || !state.currentState.trim() || !state.gitState.trim() || !state.nextAction.trim()) throw new Error("session handoff fields must be non-empty");
    if (!Number.isSafeInteger(state.contextCharacters) || state.contextCharacters < 0) throw new Error("contextCharacters must be a non-negative integer");
    const completed = ratio(state.completedContextRatio, "completedContextRatio");
    const noise = ratio(state.noiseRatio, "noiseRatio");
    const reasons: string[] = [];
    if (state.contextCharacters >= this.config.freshSessionCharacters) reasons.push("context size reached the configured fresh-session threshold");
    if (completed >= this.config.freshSessionCompletedRatio) reasons.push("most current context describes completed work");
    if (noise >= this.config.freshSessionNoiseRatio) reasons.push("context noise reached the configured threshold");
    const handoff = [
      "# Fresh Development Session Handoff", "", `Objective: ${state.objective}`, "", "## Current State", state.currentState,
      "", "## Completed Work", ...bullets(state.completedWork), "", "## Unresolved Issues", ...bullets(state.unresolvedIssues),
      "", "## Relevant Files", ...bullets(state.relevantFiles), "", "## Verification", ...bullets(state.verification),
      "", "## Git State", state.gitState, "", "## Next Action", state.nextAction, ""
    ].join("\n").slice(0, 8_000);
    return { freshSessionRecommended: reasons.length > 0, reason: reasons.length ? `Start fresh because ${reasons.join(" and ")}.` : "Continue the current session; configured context thresholds are not exceeded.", handoff };
  }
}
