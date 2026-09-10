import { resolve } from "node:path";
import { createLocalModel } from "../local/registry.js";
import { ViralRuntime } from "./engine.js";
import { ModelAvailabilityCondition, NoopTaskHandler, OwnerGatedTaskHandler } from "./integrations.js";
import { JsonRuntimeStore } from "./store.js";

export async function createDefaultRuntime(root: string, dataDirectory?: string): Promise<ViralRuntime> {
  const directory = resolve(dataDirectory ?? resolve(root, ".viral", "runtime"));
  const localModel = await createLocalModel(root);
  return new ViralRuntime(
    new JsonRuntimeStore(directory),
    [new NoopTaskHandler(), new OwnerGatedTaskHandler()],
    [new ModelAvailabilityCondition(localModel)]
  );
}
