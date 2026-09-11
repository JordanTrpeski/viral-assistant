import { launchTask, type HarnessExecutionOptions } from "../harness/coordinator.js";
import type { DevelopmentHarness, HarnessId, PersistedHarnessRun } from "../harness/types.js";
import { readTask } from "../tasks.js";
import type { EfficiencyRecorder, GovernedRunResult, GovernorRequest, SelectionDecision } from "./types.js";
import { EfficiencyGovernor } from "./governor.js";

type Launcher = (root: string, harness: DevelopmentHarness, taskId: string, timeoutMs: number, options?: HarnessExecutionOptions) => Promise<PersistedHarnessRun>;

export class GovernedDevelopmentExecutor {
  constructor(
    private readonly root: string,
    private readonly governor: EfficiencyGovernor,
    private readonly harnesses: Record<HarnessId, DevelopmentHarness>,
    private readonly recorder?: EfficiencyRecorder,
    private readonly launcher: Launcher = launchTask
  ) {}

  async planTask(taskId: string, options: Partial<Omit<GovernorRequest, "taskId" | "objective">> = {}) {
    const task = await readTask(this.root, taskId);
    return await this.governor.plan({ ...options, taskId, objective: task.objective, workKind: "development" });
  }

  async planObjectiveTask(taskId: string, options: Partial<Omit<GovernorRequest, "taskId" | "objective" | "workKind">> = {}) {
    const task = await readTask(this.root, taskId);
    return await this.governor.plan({ ...options, taskId, objective: task.objective });
  }

  async executeDecision(taskId: string, timeoutMs: number, decision: SelectionDecision): Promise<PersistedHarnessRun> {
    if (decision.taskId !== taskId) throw new Error("Efficiency decision does not belong to the selected task");
    if (decision.action !== "EXECUTE" || decision.tier !== "CODING_HARNESS" || !decision.harness) throw new Error("Efficiency decision does not authorize a coding harness launch");
    const selection = { tier: "CODING_HARNESS" as const, effort: decision.effort, harness: decision.harness, model: decision.model, reason: decision.reason };
    const started = Date.now();
    const run = await this.launcher(this.root, this.harnesses[decision.harness], taskId, timeoutMs, {
      reasoningEffort: decision.effort.toLowerCase() as "low" | "medium" | "high",
      ...(decision.model ? { model: decision.model } : {}), selection
    });
    await this.recorder?.record(decision, { type: "EXECUTION", durationMs: Date.now() - started, succeeded: run.succeeded });
    return run;
  }

  async runTask(taskId: string, timeoutMs: number, options: Partial<Omit<GovernorRequest, "taskId" | "objective">> = {}): Promise<GovernedRunResult> {
    const decision = await this.planTask(taskId, options);
    if (decision.action !== "EXECUTE" || decision.tier !== "CODING_HARNESS" || !decision.harness) return { decision, launched: false, run: null };
    return { decision, launched: true, run: await this.executeDecision(taskId, timeoutMs, decision) };
  }
}
