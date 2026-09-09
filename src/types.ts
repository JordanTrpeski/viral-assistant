export const milestoneStatuses = ["not_started", "in_progress", "blocked", "complete"] as const;
export type MilestoneStatus = (typeof milestoneStatuses)[number];

export const taskStatuses = ["pending", "in_progress", "blocked", "complete"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export interface DevelopmentState {
  schemaVersion: 1;
  project: string;
  currentMilestone: string;
  milestoneStatus: MilestoneStatus;
  activeTask: string | null;
  completedTasks: string[];
  blockers: string[];
  lastVerifiedCommit: string | null;
  lastCheckpoint: string | null;
  lastHarnessRun?: string | null;
  nextAction: string;
  notes: string[];
}

export interface VerificationResult {
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface VerificationReport {
  schemaVersion: 1;
  executedAt: string;
  passed: boolean;
  results: VerificationResult[];
}

export interface DevelopmentTask {
  schemaVersion: 1;
  id: string;
  milestone: string;
  objective: string;
  status: TaskStatus;
  acceptanceCriteria: string[];
  dependencies: string[];
  relevantFiles: string[];
  notes: string[];
  nextAction: string;
  verificationResult: VerificationReport | null;
}

export interface GitState {
  branch: string;
  head: string;
  workingTreeStatus: "clean" | "dirty";
  changedFiles: string[];
}
