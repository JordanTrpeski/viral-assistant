import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generateCheckpoint } from "../checkpoint.js";
import { loadProjectContext } from "../context.js";
import { writeJson } from "../files.js";
import { prepareTaskPacket } from "../packet.js";
import { loadState, saveState } from "../state.js";
import type { DevelopmentHarness, PersistedHarnessRun } from "./types.js";

export async function launchTask(root: string, harness: DevelopmentHarness, taskId: string, timeoutMs: number): Promise<PersistedHarnessRun> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) throw new Error("timeoutMs must be an integer of at least 1000");
  await loadProjectContext(root);
  const packet = await prepareTaskPacket(root, taskId);
  const result = await harness.launch({ root, packet: packet.content, timeoutMs });
  const timestamp = result.startedAt.replace(/[^0-9]/g, "").slice(0, 17);
  const runId = `${timestamp}-${harness.id}-${taskId}`;
  const relativePath = `runs/${runId}.json`;
  const record: PersistedHarnessRun = { schemaVersion: 1, runId, taskId, packetPath: packet.path, ...result };
  await mkdir(join(root, "runs"), { recursive: true });
  await writeJson(join(root, relativePath), record);
  const state = await loadState(root);
  await saveState(root, { ...state, lastHarnessRun: relativePath });
  await generateCheckpoint(root);
  return record;
}
