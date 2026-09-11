import { access } from "node:fs/promises";
import { join } from "node:path";
import type { GovernedDevelopmentExecutor } from "./efficiency/execution.js";
import type { GovernorRequest, SelectionDecision } from "./efficiency/types.js";
import type { PersistedHarnessRun } from "./harness/types.js";
import type { LocalBrain, Summary } from "./local/tasks.js";
import type { LocalTaskResult } from "./local/types.js";
import { loadState, saveState } from "./state.js";
import { readTask, saveTask, updateTask } from "./tasks.js";
import type { DevelopmentState, DevelopmentTask } from "./types.js";

type PlanOptions = Partial<Omit<GovernorRequest, "taskId" | "objective" | "workKind">>;
type ObjectiveExecutor = Pick<GovernedDevelopmentExecutor, "planObjectiveTask" | "executeDecision">;
type ObjectiveBrain = Pick<LocalBrain, "summarize">;
type ObjectiveFinalizer = { finalize(taskId: string): Promise<{ succeeded: boolean; diagnostic: string }> };

export interface ObjectiveOptions {
  planOnly?: boolean;
  timeoutMs?: number;
}

export interface ObjectiveExecution {
  kind: "DETERMINISTIC" | "LOCAL_MODEL" | "CODING_HARNESS";
  succeeded: boolean;
  output: string | null;
  run: PersistedHarnessRun | null;
}

export interface ObjectiveSubmission {
  taskId: string;
  taskPath: string;
  planOnly: boolean;
  decision: SelectionDecision;
  execution: ObjectiveExecution | null;
  task: DevelopmentTask;
}

function stamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("objective clock returned an invalid date");
  return date.toISOString().replace(/[^0-9]/g, "").slice(0, 17);
}

function deterministicStatusObjective(objective: string): boolean {
  return /\b(current|show|report|get|check)\b.{0,50}\b(project|development|repository)\b.{0,30}\b(status|state)\b/i.test(objective)
    || /\b(current|show|report|get|check)\b.{0,30}\b(status|state)\b.{0,50}\b(project|development|repository)\b/i.test(objective);
}

function policyHints(objective: string): PlanOptions {
  const mainMerge = /\bmerge\b.{0,40}\bmain\b/i.test(objective);
  const majorPolicy = /\b(PRODUCT\.md|RULES\.md|privacy policy|security policy|major roadmap|roadmap direction|redefine.{0,30}(purpose|product))\b/i.test(objective);
  const architectureChange = /\b(architecture|architectural|schema migration)\b/i.test(objective);
  const securitySensitive = /\b(authentication|authorization|credential|encryption|security-sensitive)\b/i.test(objective);
  return {
    ...(deterministicStatusObjective(objective) ? { deterministicAvailable: true } : {}),
    ...(mainMerge ? { ownerGate: "main_merge" as const } : majorPolicy ? { ownerGate: "major_policy" as const } : {}),
    ...(architectureChange ? { architectureChange: true } : {}),
    ...(securitySensitive ? { securitySensitive: true } : {}),
    ...((architectureChange || securitySensitive) ? { risk: "high" as const } : {})
  };
}

async function availableTaskId(root: string, now: Date): Promise<string> {
  const base = `OBJ-${stamp(now)}`;
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const id = suffix === 0 ? base : `${base}-${suffix + 1}`;
    try { await access(join(root, "tasks", `${id}.json`)); }
    catch { return id; }
  }
  throw new Error("Could not allocate a unique objective task id");
}

function taskFor(state: DevelopmentState, id: string, objective: string): DevelopmentTask {
  return {
    schemaVersion: 1,
    id,
    milestone: state.currentMilestone,
    objective,
    status: "pending",
    acceptanceCriteria: [
      `Owner objective is satisfied: ${objective}`,
      "Repository rules and current approved milestone boundaries are preserved.",
      "Relevant automated verification passes and continuity state is updated."
    ],
    dependencies: [],
    relevantFiles: ["AGENTS.md", "EFFICIENCY.md", "STATE.json", `milestones/${state.currentMilestone}.md`],
    notes: ["Created from the owner-facing viral-dev objective command."],
    nextAction: "Apply the Efficiency Governor and begin authorized execution.",
    verificationResult: null
  };
}

function decisionNote(decision: SelectionDecision): string {
  return `Efficiency selection: ${decision.action} / ${decision.tier} / ${decision.effort}. ${decision.reason}`;
}

export class OwnerObjectiveService {
  constructor(
    private readonly root: string,
    private readonly executor: ObjectiveExecutor,
    private readonly localBrain: ObjectiveBrain,
    private readonly now: () => Date = () => new Date(),
    private readonly finalizer?: ObjectiveFinalizer
  ) {}

  private async focus(state: DevelopmentState, taskId: string, nextAction: string): Promise<void> {
    await saveState(this.root, { ...state, activeTask: taskId, nextAction });
  }

  private async complete(state: DevelopmentState, taskId: string, note: string): Promise<DevelopmentTask> {
    const task = await updateTask(this.root, taskId, { status: "complete", notes: [...(await readTask(this.root, taskId)).notes, note], nextAction: "Objective completed." });
    await saveState(this.root, {
      ...state,
      activeTask: state.activeTask,
      completedTasks: state.completedTasks.includes(taskId) ? state.completedTasks : [...state.completedTasks, taskId],
      nextAction: state.nextAction
    });
    return task;
  }

  async submit(rawObjective: string, options: ObjectiveOptions = {}): Promise<ObjectiveSubmission> {
    const objective = rawObjective.trim();
    if (!objective) throw new Error("objective requires non-empty natural-language text");
    if (objective.length > 4_000) throw new Error("objective must not exceed 4000 characters");
    const timeoutMs = options.timeoutMs ?? 900_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) throw new Error("timeoutMs must be an integer of at least 1000");

    const state = await loadState(this.root);
    const taskId = await availableTaskId(this.root, this.now());
    await saveTask(this.root, taskFor(state, taskId, objective));
    await this.focus(state, taskId, `Plan and execute owner objective ${taskId}.`);

    const decision = await this.executor.planObjectiveTask(taskId, policyHints(objective));
    const current = await readTask(this.root, taskId);
    await updateTask(this.root, taskId, { notes: [...current.notes, decisionNote(decision)] });

    if (options.planOnly) {
      const task = await updateTask(this.root, taskId, { nextAction: `Review the plan, then run the task through the selected ${decision.tier} capability.` });
      return { taskId, taskPath: `tasks/${taskId}.json`, planOnly: true, decision, execution: null, task };
    }

    if (decision.action !== "EXECUTE") {
      const task = await updateTask(this.root, taskId, { status: "blocked", nextAction: decision.reason });
      await this.focus(state, taskId, decision.reason);
      return { taskId, taskPath: `tasks/${taskId}.json`, planOnly: false, decision, execution: null, task };
    }

    if (decision.tier === "DETERMINISTIC") {
      const output = JSON.stringify({ project: state.project, milestone: state.currentMilestone, milestoneStatus: state.milestoneStatus, blockers: state.blockers, nextAction: state.nextAction }, null, 2);
      const task = await this.complete(state, taskId, `Deterministic result: ${output}`);
      return { taskId, taskPath: `tasks/${taskId}.json`, planOnly: false, decision, execution: { kind: "DETERMINISTIC", succeeded: true, output, run: null }, task };
    }

    if (decision.tier === "LOCAL_MODEL") {
      const local: LocalTaskResult<Summary> = await this.localBrain.summarize(objective, { project: state.project, milestone: state.currentMilestone, milestoneStatus: state.milestoneStatus, blockers: state.blockers, nextAction: state.nextAction }, { timeoutMs });
      if (local.succeeded && local.value) {
        const task = await this.complete(state, taskId, `Local result: ${local.value.text}`);
        return { taskId, taskPath: `tasks/${taskId}.json`, planOnly: false, decision, execution: { kind: "LOCAL_MODEL", succeeded: true, output: local.value.text, run: null }, task };
      }
      const diagnostic = local.diagnostics.join(" ") || "Local objective execution failed.";
      const task = await updateTask(this.root, taskId, { status: "blocked", notes: [...(await readTask(this.root, taskId)).notes, diagnostic], nextAction: diagnostic });
      await this.focus(state, taskId, diagnostic);
      return { taskId, taskPath: `tasks/${taskId}.json`, planOnly: false, decision, execution: { kind: "LOCAL_MODEL", succeeded: false, output: diagnostic, run: null }, task };
    }

    await updateTask(this.root, taskId, { status: "in_progress", nextAction: `Continue through the selected ${decision.harness ?? "coding"} harness.` });
    try {
      const run = await this.executor.executeDecision(taskId, timeoutMs, decision);
      const task = await readTask(this.root, taskId);
      if (!run.succeeded && task.status !== "complete") {
        const diagnostic = run.diagnostics.join(" ") || "Coding harness execution failed.";
        const blocked = await updateTask(this.root, taskId, { status: "blocked", notes: [...task.notes, diagnostic], nextAction: diagnostic });
        await this.focus(state, taskId, diagnostic);
        return { taskId, taskPath: `tasks/${taskId}.json`, planOnly: false, decision, execution: { kind: "CODING_HARNESS", succeeded: false, output: diagnostic, run }, task: blocked };
      }
      if (run.succeeded && this.finalizer) {
        const finalized = await this.finalizer.finalize(taskId);
        const finalizedTask = await readTask(this.root, taskId);
        return { taskId, taskPath: `tasks/${taskId}.json`, planOnly: false, decision, execution: { kind: "CODING_HARNESS", succeeded: finalized.succeeded, output: finalized.diagnostic, run }, task: finalizedTask };
      }
      return { taskId, taskPath: `tasks/${taskId}.json`, planOnly: false, decision, execution: { kind: "CODING_HARNESS", succeeded: run.succeeded, output: null, run }, task };
    } catch (error) {
      const diagnostic = (error as Error).message;
      const task = await updateTask(this.root, taskId, { status: "blocked", notes: [...(await readTask(this.root, taskId)).notes, diagnostic], nextAction: diagnostic });
      await this.focus(state, taskId, diagnostic);
      return { taskId, taskPath: `tasks/${taskId}.json`, planOnly: false, decision, execution: { kind: "CODING_HARNESS", succeeded: false, output: diagnostic, run: null }, task };
    }
  }
}
