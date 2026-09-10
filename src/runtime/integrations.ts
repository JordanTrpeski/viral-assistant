import type { LocalModel } from "../local/types.js";
import type { HandlerContext, HandlerOutcome, JsonValue, RuntimeCondition, RuntimeConditionSpec, RuntimeTask, RuntimeTaskHandler } from "./types.js";

export class ModelAvailabilityCondition implements RuntimeCondition {
  readonly type = "model_available";
  constructor(private readonly model: LocalModel) {}
  async evaluate(spec: RuntimeConditionSpec): Promise<boolean> {
    const probe = await this.model.probe();
    const requested = spec.parameters.model;
    return probe.usable && (typeof requested !== "string" || probe.models.includes(requested));
  }
}

export class NoopTaskHandler implements RuntimeTaskHandler {
  readonly type = "noop";
  async execute(task: RuntimeTask, _context: HandlerContext): Promise<HandlerOutcome> {
    return { type: "completed", result: task.payload };
  }
}

export class OwnerGatedTaskHandler implements RuntimeTaskHandler {
  readonly type = "owner-gated";
  async execute(task: RuntimeTask, _context: HandlerContext): Promise<HandlerOutcome> {
    if (!task.ownerInputProvided) return { type: "owner_input_required", prompt: "Explicit owner input is required before this task can continue." };
    const result: JsonValue = { ownerResponse: task.ownerInputResponse };
    return { type: "completed", result };
  }
}
