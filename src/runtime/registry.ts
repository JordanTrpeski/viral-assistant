import { resolve } from "node:path";
import { TaskLogger, attachTaskLogger } from "../efficiency/logs.js";
import { createEfficiencyServices } from "../efficiency/registry.js";
import { EfficiencyModelAvailabilityCondition, GovernedDevelopmentTaskHandler } from "../efficiency/runtime.js";
import { ViralRuntime } from "./engine.js";
import { ModelAvailabilityCondition, NoopTaskHandler, OwnerGatedTaskHandler } from "./integrations.js";
import { JsonRuntimeStore } from "./store.js";

export async function createDefaultRuntime(root: string, dataDirectory?: string): Promise<ViralRuntime> {
  const directory = resolve(dataDirectory ?? resolve(root, ".viral", "runtime"));
  const services = await createEfficiencyServices(root);
  const runtime = new ViralRuntime(
    new JsonRuntimeStore(directory),
    [new NoopTaskHandler(), new OwnerGatedTaskHandler(), new GovernedDevelopmentTaskHandler(services.executor)],
    [new ModelAvailabilityCondition(services.localModel), new EfficiencyModelAvailabilityCondition(services.localModel, services.harnesses)]
  );
  // Task execution log: mirror every task-lifecycle event to .viral/logs/tasks-YYYY-MM-DD.jsonl.
  attachTaskLogger(runtime, new TaskLogger(root));
  return runtime;
}
