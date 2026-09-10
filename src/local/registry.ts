import { existsSync } from "node:fs";
import { join } from "node:path";
import { NodeProcessRunner } from "../harness/process.js";
import { loadLocalModelConfig } from "./config.js";
import { FetchLocalHttpTransport } from "./http.js";
import { OllamaLocalModel } from "./ollama.js";
import type { LocalModel } from "./types.js";

export async function createLocalModel(root: string): Promise<LocalModel> {
  const config = await loadLocalModelConfig(root);
  const installedPath = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe") : null;
  const executable = installedPath && existsSync(installedPath) ? installedPath : "ollama";
  return new OllamaLocalModel(config, { processRunner: new NodeProcessRunner(), http: new FetchLocalHttpTransport(), executable });
}
