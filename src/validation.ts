import { milestoneStatuses, taskStatuses, type DevelopmentState, type DevelopmentTask } from "./types.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be an array of strings`);
  return value as string[];
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

export function validateState(value: unknown): DevelopmentState {
  const data = object(value, "STATE.json");
  if (data.schemaVersion !== 1) throw new Error("STATE.json.schemaVersion must equal 1");
  const status = string(data.milestoneStatus, "STATE.json.milestoneStatus");
  if (!milestoneStatuses.includes(status as DevelopmentState["milestoneStatus"])) throw new Error(`STATE.json.milestoneStatus is invalid: ${status}`);
  return {
    schemaVersion: 1,
    project: string(data.project, "STATE.json.project"),
    currentMilestone: string(data.currentMilestone, "STATE.json.currentMilestone"),
    milestoneStatus: status as DevelopmentState["milestoneStatus"],
    activeTask: nullableString(data.activeTask, "STATE.json.activeTask"),
    completedTasks: strings(data.completedTasks, "STATE.json.completedTasks"),
    blockers: strings(data.blockers, "STATE.json.blockers"),
    lastVerifiedCommit: nullableString(data.lastVerifiedCommit, "STATE.json.lastVerifiedCommit"),
    lastCheckpoint: nullableString(data.lastCheckpoint, "STATE.json.lastCheckpoint"),
    nextAction: string(data.nextAction, "STATE.json.nextAction"),
    notes: strings(data.notes, "STATE.json.notes")
  };
}

export function validateTask(value: unknown, label = "task"): DevelopmentTask {
  const data = object(value, label);
  if (data.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must equal 1`);
  const status = string(data.status, `${label}.status`);
  if (!taskStatuses.includes(status as DevelopmentTask["status"])) throw new Error(`${label}.status is invalid: ${status}`);
  return {
    schemaVersion: 1,
    id: string(data.id, `${label}.id`),
    milestone: string(data.milestone, `${label}.milestone`),
    objective: string(data.objective, `${label}.objective`),
    status: status as DevelopmentTask["status"],
    acceptanceCriteria: strings(data.acceptanceCriteria, `${label}.acceptanceCriteria`),
    dependencies: strings(data.dependencies, `${label}.dependencies`),
    relevantFiles: strings(data.relevantFiles, `${label}.relevantFiles`),
    notes: strings(data.notes, `${label}.notes`),
    nextAction: string(data.nextAction, `${label}.nextAction`),
    verificationResult: data.verificationResult === null ? null : object(data.verificationResult, `${label}.verificationResult`) as unknown as DevelopmentTask["verificationResult"]
  };
}

