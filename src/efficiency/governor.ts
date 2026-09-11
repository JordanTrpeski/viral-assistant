import { deterministicEscalation } from "../local/policy.js";
import type { HarnessId, HarnessProbe } from "../harness/types.js";
import { ObjectiveRefiner, maxRefinementIterations } from "./refinement.js";
import type { EfficiencyConfig, GovernorDependencies, GovernorRequest, ReasoningEffort, SelectionDecision, WorkKind } from "./types.js";

function integer(value: number | undefined, label: string): number {
  const result = value ?? 0;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label} must be a non-negative integer`);
  return result;
}
function ratio(value: number | undefined, label: string): number {
  const result = value ?? 0;
  if (!Number.isFinite(result) || result < 0 || result > 1) throw new Error(`${label} must be between 0 and 1`);
  return result;
}
function alternate(id: HarnessId): HarnessId { return id === "codex" ? "claude" : "codex"; }
function retryTime(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!Number.isFinite(Date.parse(value))) throw new Error("earliestModelRetryAt must be an ISO timestamp");
  return value;
}

export class EfficiencyGovernor {
  constructor(private readonly config: EfficiencyConfig, private readonly dependencies: GovernorDependencies, private readonly refiner: ObjectiveRefiner = new ObjectiveRefiner()) {}

  private effort(request: GovernorRequest, failures: number): ReasoningEffort {
    if (request.risk === "high" || request.architectureChange || request.securitySensitive || failures >= this.config.failuresPerEffortLevel * 2) return "HIGH";
    if (request.risk === "normal" || request.workKind === "development" || failures >= this.config.failuresPerEffortLevel) return "MEDIUM";
    return "LOW";
  }

  private freshSession(request: GovernorRequest): boolean {
    return integer(request.contextCharacters, "contextCharacters") >= this.config.freshSessionCharacters
      || ratio(request.completedContextRatio, "completedContextRatio") >= this.config.freshSessionCompletedRatio
      || ratio(request.contextNoiseRatio, "contextNoiseRatio") >= this.config.freshSessionNoiseRatio;
  }

  private decision(request: GovernorRequest, details: Omit<SelectionDecision, "schemaVersion" | "taskId" | "freshSessionRecommended" | "failureCount" | "maximumAttempts">, failures: number): SelectionDecision {
    return {
      schemaVersion: 1,
      taskId: request.taskId,
      freshSessionRecommended: this.freshSession(request),
      failureCount: failures,
      maximumAttempts: this.config.maximumAttempts,
      ...details,
      reason: details.reason.slice(0, 300)
    };
  }

  private async kind(request: GovernorRequest): Promise<WorkKind | "owner" | "unsure"> {
    if (request.workKind) return request.workKind;
    const deterministic = deterministicEscalation(request.objective);
    if (deterministic === "OWNER_INPUT_REQUIRED") return "owner";
    if (deterministic === "CODING_HARNESS_REQUIRED") return "development";
    if (deterministic === "LOCAL_OK") return "local_reasoning";
    if (!this.dependencies.classify) return "unsure";
    const recommendation = await this.dependencies.classify(request.objective);
    if (recommendation === "OWNER_INPUT_REQUIRED") return "owner";
    if (recommendation === "CODING_HARNESS_REQUIRED") return "development";
    if (recommendation === "LOCAL_OK") return "local_reasoning";
    return "unsure";
  }

  private async harnessDecision(request: GovernorRequest, effort: ReasoningEffort, failures: number, prefix = ""): Promise<SelectionDecision> {
    const selected = request.requestedHarness ?? this.config.primaryHarness;
    const isSwitch = selected !== this.config.primaryHarness || (request.currentHarness !== undefined && selected !== request.currentHarness);
    const switchAllowed = request.paidSwitchApproved === true || this.config.allowAutomaticPaidHarnessSwitch;
    if (isSwitch && !switchAllowed) {
      return this.decision(request, { action: "OWNER_INPUT_REQUIRED", tier: "CODING_HARNESS", effort, harness: selected, model: null, ownerInputRequired: true, nextProbeAt: null, reason: `${prefix}Switching to paid/cloud harness ${selected} requires owner approval.` }, failures);
    }
    const probe = await this.dependencies.harnessProbe(selected);
    if (probe.usable === true) {
      return this.decision(request, { action: "EXECUTE", tier: "CODING_HARNESS", effort, harness: selected, model: null, ownerInputRequired: false, nextProbeAt: null, reason: `${prefix}Selected ${selected} with ${effort} effort because development work requires an authenticated coding harness and the selected harness is usable.` }, failures);
    }
    const other = alternate(selected);
    const otherProbe: HarnessProbe = await this.dependencies.harnessProbe(other);
    if (otherProbe.usable === true && !switchAllowed) {
      return this.decision(request, { action: "OWNER_INPUT_REQUIRED", tier: "CODING_HARNESS", effort, harness: other, model: null, ownerInputRequired: true, nextProbeAt: null, reason: `${prefix}${selected} is unavailable; switching to paid/cloud harness ${other} requires owner approval.` }, failures);
    }
    if (otherProbe.usable === true && switchAllowed) {
      return this.decision(request, { action: "EXECUTE", tier: "CODING_HARNESS", effort, harness: other, model: null, ownerInputRequired: false, nextProbeAt: null, reason: `${prefix}${selected} is unavailable; selected authorized alternate harness ${other} with ${effort} effort.` }, failures);
    }
    return this.decision(request, { action: "WAITING_FOR_MODEL", tier: "CODING_HARNESS", effort, harness: selected, model: null, ownerInputRequired: false, nextProbeAt: retryTime(request.earliestModelRetryAt), reason: `${prefix}No authorized coding harness is currently confirmed usable; wait without model usage and probe again before resuming.` }, failures);
  }

  async plan(request: GovernorRequest): Promise<SelectionDecision> {
    if (!request.taskId.trim() || !request.objective.trim()) throw new Error("taskId and objective must be non-empty");
    const failures = integer(request.failureCount, "failureCount");
    const effort = this.effort(request, failures);
    // Iterative refinement gate: detect embedded answers, validate their clarity, and ask follow-ups
    // only for vague/missing answers. Proceeds once all answers are clear or the iteration cap is hit.
    const refinement = this.refiner.refine(request.objective);
    if (refinement.action === "OWNER_INPUT_REQUIRED") {
      const decision = this.decision(request, {
        action: "OWNER_INPUT_REQUIRED", tier: "DETERMINISTIC", effort: "HIGH", harness: null, model: null,
        ownerInputRequired: true, nextProbeAt: null, clarifyingQuestions: refinement.questions,
        reason: `Objective needs refinement (iteration ${refinement.iteration}/${maxRefinementIterations}); owner input required on ${refinement.questions.length} question(s).`
      }, failures);
      await this.dependencies.recorder?.record(decision, { contextBudgetCharacters: this.config.initialContextCharacters });
      return decision;
    }
    let decision: SelectionDecision;
    if ((request.ownerGate ?? "none") !== "none") {
      decision = this.decision(request, { action: "OWNER_INPUT_REQUIRED", tier: "DETERMINISTIC", effort: "HIGH", harness: null, model: null, ownerInputRequired: true, nextProbeAt: null, reason: `Owner approval is required for ${request.ownerGate?.replaceAll("_", " ")}.` }, failures);
    } else if (failures >= this.config.maximumAttempts) {
      decision = this.decision(request, { action: "OWNER_INPUT_REQUIRED", tier: "DETERMINISTIC", effort: "HIGH", harness: null, model: null, ownerInputRequired: true, nextProbeAt: null, reason: `Bounded retry limit of ${this.config.maximumAttempts} attempts reached; owner input is required.` }, failures);
    } else if (request.deterministicAvailable) {
      decision = this.decision(request, { action: "EXECUTE", tier: "DETERMINISTIC", effort, harness: null, model: null, ownerInputRequired: false, nextProbeAt: null, reason: `Selected deterministic software with ${effort} effort because the operation is reliably computable without model use.` }, failures);
    } else {
      const kind = await this.kind(request);
      if (kind === "owner") decision = this.decision(request, { action: "OWNER_INPUT_REQUIRED", tier: "DETERMINISTIC", effort: "HIGH", harness: null, model: null, ownerInputRequired: true, nextProbeAt: null, reason: "Deterministic policy identified a consequential owner decision." }, failures);
      else if (kind === "unsure") decision = this.decision(request, { action: "UNSURE", tier: "LOCAL_MODEL", effort, harness: null, model: null, ownerInputRequired: false, nextProbeAt: null, reason: "Available deterministic and local routing evidence is insufficient for a safe selection." }, failures);
      else if (kind === "development") decision = await this.harnessDecision(request, effort, failures);
      else {
        const local = await this.dependencies.localProbe();
        if (local.usable) {
          decision = this.decision(request, { action: "EXECUTE", tier: "LOCAL_MODEL", effort, harness: null, model: local.preferredModel ?? local.models[0] ?? null, ownerInputRequired: false, nextProbeAt: null, reason: `Selected local model ${local.preferredModel ?? local.models[0] ?? "available default"} with ${effort} effort because routine reasoning can be completed locally.` }, failures);
        } else decision = await this.harnessDecision(request, effort, failures, "Local reasoning is unavailable; ");
      }
    }
    await this.dependencies.recorder?.record(decision, { ...(request.contextCharacters === undefined ? {} : { contextCharacters: request.contextCharacters }), contextBudgetCharacters: this.config.initialContextCharacters });
    return decision;
  }
}
