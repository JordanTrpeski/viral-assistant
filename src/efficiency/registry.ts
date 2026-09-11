import { resolve } from "node:path";
import { OwnerObjectiveService } from "../objective.js";
import { createHarnesses } from "../harness/registry.js";
import { createLocalModel } from "../local/registry.js";
import { LocalBrain } from "../local/tasks.js";
import { loadEfficiencyConfig } from "./config.js";
import { EfficiencyContextPlanner } from "./context.js";
import { GovernedDevelopmentExecutor } from "./execution.js";
import { EfficiencyGovernor } from "./governor.js";
import { EfficiencySessionPlanner } from "./session.js";
import { EfficiencyTelemetry, JsonEfficiencyStore } from "./telemetry.js";

export async function createEfficiencyServices(root: string, dataDirectory?: string) {
  const config = await loadEfficiencyConfig(root);
  const localModel = await createLocalModel(root);
  const localBrain = new LocalBrain(localModel);
  const harnesses = createHarnesses(root);
  const telemetry = new EfficiencyTelemetry(new JsonEfficiencyStore(resolve(dataDirectory ?? resolve(root, ".viral", "efficiency"))), config.maximumTelemetryEvents);
  const governor = new EfficiencyGovernor(config, {
    localProbe: async () => await localModel.probe(),
    harnessProbe: async (id) => await harnesses[id].probe(),
    classify: async (objective) => (await localBrain.classify(objective)).escalation,
    recorder: telemetry
  });
  const contextPlanner = new EfficiencyContextPlanner(config, localBrain);
  const sessionPlanner = new EfficiencySessionPlanner(config);
  const executor = new GovernedDevelopmentExecutor(root, governor, harnesses, telemetry);
  const objectives = new OwnerObjectiveService(root, executor, localBrain);
  return { config, localModel, localBrain, harnesses, telemetry, governor, contextPlanner, sessionPlanner, executor, objectives };
}
