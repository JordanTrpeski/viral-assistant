import type { DevelopmentHarness, HarnessId } from "../harness/types.js";
import type { LocalModel } from "../local/types.js";
import type { HandlerOutcome, RuntimeCondition, RuntimeConditionSpec, RuntimeTask, RuntimeTaskHandler } from "../runtime/types.js";
import type { GovernedDevelopmentExecutor } from "./execution.js";

function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function harnessId(value: unknown): HarnessId | null { return value === "codex" || value === "claude" ? value : null; }

export class EfficiencyModelAvailabilityCondition implements RuntimeCondition {
  readonly type = "efficiency_model_available";
  constructor(private readonly localModel: LocalModel, private readonly harnesses: Record<HarnessId, DevelopmentHarness>, private readonly now = () => new Date()) {}
  async evaluate(spec: RuntimeConditionSpec): Promise<boolean> {
    const earliest = text(spec.parameters.earliestRetryAt);
    if (earliest && Date.parse(earliest) > this.now().getTime()) return false;
    const capability = text(spec.parameters.capability);
    if (capability === "local") {
      const probe = await this.localModel.probe();
      const model = text(spec.parameters.model);
      return probe.usable && (!model || probe.models.includes(model));
    }
    if (capability === "harness") {
      const id = harnessId(spec.parameters.harness);
      return id !== null && (await this.harnesses[id].probe()).usable === true;
    }
    return false;
  }
}

export class GovernedDevelopmentTaskHandler implements RuntimeTaskHandler {
  readonly type = "governed-development";
  constructor(private readonly executor: Pick<GovernedDevelopmentExecutor, "runTask">, private readonly timeoutMs = 900_000) {}
  async execute(task: RuntimeTask): Promise<HandlerOutcome> {
    if (typeof task.payload !== "object" || task.payload === null || Array.isArray(task.payload)) return { type: "failed", error: "governed-development payload must be an object" };
    const taskId = text(task.payload.taskId);
    if (!taskId) return { type: "failed", error: "governed-development payload.taskId is required" };
    const paidSwitchApproved = task.ownerInputProvided && (task.ownerInputResponse === true || (typeof task.ownerInputResponse === "object" && task.ownerInputResponse !== null && !Array.isArray(task.ownerInputResponse) && task.ownerInputResponse.approvePaidSwitch === true));
    const result = await this.executor.runTask(taskId, this.timeoutMs, {
      failureCount: task.failureCount,
      paidSwitchApproved,
      earliestModelRetryAt: text(task.payload.earliestModelRetryAt),
      ...(harnessId(task.payload.requestedHarness) ? { requestedHarness: harnessId(task.payload.requestedHarness)! } : {})
    });
    if (result.launched && result.run) return result.run.succeeded ? { type: "completed", result: { runId: result.run.runId, harness: result.decision.harness, effort: result.decision.effort } } : { type: "failed", error: (result.run.error ?? result.run.stderr) || "Governed harness run failed" };
    if (result.decision.action === "OWNER_INPUT_REQUIRED") return { type: "owner_input_required", prompt: result.decision.reason };
    if (result.decision.action === "WAITING_FOR_MODEL") return {
      type: "waiting_for_model",
      condition: { type: "efficiency_model_available", parameters: { capability: "harness", harness: result.decision.harness, earliestRetryAt: result.decision.nextProbeAt } }
    };
    return { type: "failed", error: result.decision.reason };
  }
}
