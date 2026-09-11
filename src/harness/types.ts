export type HarnessId = "codex" | "claude";

export interface ProcessCommand {
  executable: string;
  prefixArgs?: string[];
}

export interface ProcessSpec {
  executable: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
}

export interface ProcessResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface ProcessRunner {
  run(spec: ProcessSpec): Promise<ProcessResult>;
}

export interface HarnessProbe {
  id: HarnessId;
  displayName: string;
  executable: string;
  installed: boolean;
  usable: boolean | null;
  version: string | null;
  diagnostics: string[];
}

export type HarnessReasoningEffort = "low" | "medium" | "high";
export interface HarnessSelectionRecord {
  tier: "CODING_HARNESS";
  effort: "LOW" | "MEDIUM" | "HIGH";
  harness: HarnessId;
  model: string | null;
  reason: string;
}

export interface HarnessLaunchRequest {
  root: string;
  packet: string;
  timeoutMs: number;
  reasoningEffort?: HarnessReasoningEffort;
  model?: string;
}

export interface HarnessRunResult extends ProcessResult {
  harness: HarnessId;
  displayName: string;
  command: string[];
  succeeded: boolean;
  diagnostics: string[];
}

export interface PersistedHarnessRun extends HarnessRunResult {
  schemaVersion: 1;
  runId: string;
  taskId: string;
  packetPath: string;
  selection?: HarnessSelectionRecord;
}

export interface DevelopmentHarness {
  readonly id: HarnessId;
  readonly displayName: string;
  probe(): Promise<HarnessProbe>;
  launch(request: HarnessLaunchRequest): Promise<HarnessRunResult>;
}

