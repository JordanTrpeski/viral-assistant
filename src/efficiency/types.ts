import type { HarnessId, HarnessProbe, PersistedHarnessRun } from "../harness/types.js";
import type { LocalModelProbe } from "../local/types.js";

export const reasoningEfforts = ["LOW", "MEDIUM", "HIGH"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export const capabilityTiers = ["DETERMINISTIC", "LOCAL_MODEL", "CODING_HARNESS"] as const;
export type CapabilityTier = (typeof capabilityTiers)[number];
export const governorActions = ["EXECUTE", "WAITING_FOR_MODEL", "OWNER_INPUT_REQUIRED", "UNSURE"] as const;
export type GovernorAction = (typeof governorActions)[number];
export const workKinds = ["deterministic", "local_reasoning", "development"] as const;
export type WorkKind = (typeof workKinds)[number];
export const riskLevels = ["routine", "normal", "high"] as const;
export type RiskLevel = (typeof riskLevels)[number];
export const ownerGates = ["none", "consequential", "major_policy", "main_merge"] as const;
export type OwnerGate = (typeof ownerGates)[number];

export interface EfficiencyConfig {
  primaryHarness: HarnessId;
  allowAutomaticPaidHarnessSwitch: boolean;
  maximumAttempts: number;
  failuresPerEffortLevel: number;
  initialContextCharacters: number;
  maximumContextCharacters: number;
  freshSessionCharacters: number;
  freshSessionCompletedRatio: number;
  freshSessionNoiseRatio: number;
  maximumTelemetryEvents: number;
}

export interface GovernorRequest {
  taskId: string;
  objective: string;
  workKind?: WorkKind;
  deterministicAvailable?: boolean;
  risk?: RiskLevel;
  architectureChange?: boolean;
  securitySensitive?: boolean;
  failureCount?: number;
  requestedHarness?: HarnessId;
  currentHarness?: HarnessId;
  paidSwitchApproved?: boolean;
  ownerGate?: OwnerGate;
  earliestModelRetryAt?: string | null;
  contextCharacters?: number;
  completedContextRatio?: number;
  contextNoiseRatio?: number;
}

export interface SelectionDecision {
  schemaVersion: 1;
  taskId: string;
  action: GovernorAction;
  tier: CapabilityTier;
  effort: ReasoningEffort;
  harness: HarnessId | null;
  model: string | null;
  reason: string;
  ownerInputRequired: boolean;
  freshSessionRecommended: boolean;
  nextProbeAt: string | null;
  failureCount: number;
  maximumAttempts: number;
  clarifyingQuestions?: string[];
}

export interface ContextSection {
  id: string;
  content: string;
  mandatory?: boolean;
  authority?: number;
  relevance?: number;
  recency?: number;
  dependency?: number;
}

export interface ContextPlan {
  schemaVersion: 1;
  content: string;
  includedIds: string[];
  excludedIds: string[];
  summarizedIds: string[];
  originalCharacters: number;
  packetCharacters: number;
  budgetCharacters: number;
  overBudget: boolean;
  usedLocalCompression: boolean;
  diagnostics: string[];
}

export interface SessionState {
  objective: string;
  currentState: string;
  completedWork: string[];
  unresolvedIssues: string[];
  relevantFiles: string[];
  verification: string[];
  gitState: string;
  nextAction: string;
  contextCharacters: number;
  completedContextRatio: number;
  noiseRatio: number;
}

export interface SessionPlan {
  freshSessionRecommended: boolean;
  reason: string;
  handoff: string;
}

export const efficiencyEventTypes = ["SELECTION", "WAITING_FOR_MODEL", "ESCALATION", "SESSION_RESET", "EXECUTION"] as const;
export type EfficiencyEventType = (typeof efficiencyEventTypes)[number];
export interface EfficiencyEvent {
  schemaVersion: 1;
  id: string;
  occurredAt: string;
  type: EfficiencyEventType;
  taskId: string;
  tier: CapabilityTier;
  action: GovernorAction;
  effort: ReasoningEffort;
  harness: HarnessId | null;
  model: string | null;
  reason: string;
  contextCharacters: number | null;
  contextBudgetCharacters: number | null;
  failureCount: number;
  durationMs: number | null;
  succeeded: boolean | null;
}

export interface EfficiencySnapshot { schemaVersion: 1; updatedAt: string; nextSequence: number; events: EfficiencyEvent[]; }
export interface EfficiencyStore { load(): Promise<EfficiencySnapshot | null>; save(snapshot: EfficiencySnapshot): Promise<void>; }
export interface EfficiencyRecorder { record(decision: SelectionDecision, details?: { type?: EfficiencyEventType; contextCharacters?: number; contextBudgetCharacters?: number; durationMs?: number; succeeded?: boolean }): Promise<void>; snapshot(): Promise<EfficiencySnapshot>; }

export interface GovernorDependencies {
  localProbe(): Promise<LocalModelProbe>;
  harnessProbe(id: HarnessId): Promise<HarnessProbe>;
  classify?(objective: string): Promise<"LOCAL_OK" | "CODING_HARNESS_REQUIRED" | "OWNER_INPUT_REQUIRED" | "UNSURE">;
  recorder?: EfficiencyRecorder;
  now?: () => Date;
}

export interface GovernedRunResult {
  decision: SelectionDecision;
  launched: boolean;
  run: PersistedHarnessRun | null;
}
