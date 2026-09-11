import { mkdir, mkdtemp, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJson } from "./files.js";
import { inspectGit } from "./git.js";
import { createHarnesses } from "./harness/registry.js";
import type { HarnessProbe } from "./harness/types.js";
import { validateLocalModelConfig } from "./local/config.js";
import { createLocalModel } from "./local/registry.js";
import type { LocalModelProbe } from "./local/types.js";
import { validateEfficiencyConfig } from "./efficiency/config.js";
import { JsonRuntimeStore } from "./runtime/store.js";
import { validateVerificationConfig } from "./verification.js";

export interface HealthCheck { name: string; passed: boolean; detail: string; }
export interface HealthReport { schemaVersion: 1; healthy: boolean; checks: HealthCheck[]; }
export interface DoctorDependencies {
  git(): Promise<unknown>;
  local(): Promise<LocalModelProbe>;
  codex(): Promise<HarnessProbe>;
  storage(): Promise<string>;
  configuration(): Promise<unknown>;
}

export async function checkRuntimeStorage(directory: string): Promise<string> {
  // Load through the store contract, without starting/recovering the runtime.
  const snapshot = await new JsonRuntimeStore(directory).load();
  await mkdir(directory, { recursive: true });
  const scratch = await mkdtemp(join(directory, ".doctor-"));
  const source = join(scratch, "probe");
  const target = join(scratch, "renamed");
  try {
    await writeFile(source, "viral-doctor", { flag: "wx" });
    await rename(source, target);
    if (await readFile(target, "utf8") !== "viral-doctor") throw new Error("Storage round trip failed");
  } finally {
    for (const path of [source, target]) {
      await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
    await rmdir(scratch);
  }
  return snapshot ? "Readable/writable; runtime snapshot valid." : "Readable/writable; no runtime snapshot yet.";
}

export async function checkConfiguration(root: string): Promise<void> {
  const value = await readJson(join(root, "viral-dev.config.json"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid configuration");
  const config = value as Record<string, unknown>;
  validateLocalModelConfig(config.localBrain);
  validateEfficiencyConfig(config.efficiencyGovernor);
  validateVerificationConfig(config);
}

export async function runDoctor(root: string, dataDirectory?: string, dependencies?: DoctorDependencies): Promise<HealthReport> {
  const probes = dependencies ?? {
    git: () => inspectGit(root),
    local: async () => (await createLocalModel(root)).probe(),
    codex: () => createHarnesses(root).codex.probe(),
    storage: () => checkRuntimeStorage(resolve(dataDirectory ?? join(root, ".viral", "runtime"))),
    configuration: () => checkConfiguration(root)
  };
  // Isolate failures and never print raw process output, config values, or runtime data.
  const [git, local, codex, storage, configuration] = await Promise.allSettled([
    Promise.resolve().then(probes.git), Promise.resolve().then(probes.local),
    Promise.resolve().then(probes.codex), Promise.resolve().then(probes.storage),
    Promise.resolve().then(probes.configuration)
  ]);
  const lp = local.status === "fulfilled" ? local.value : null;
  const cp = codex.status === "fulfilled" ? codex.value : null;
  const checks: HealthCheck[] = [
    { name: "Git", passed: git.status === "fulfilled", detail: git.status === "fulfilled" ? "Repository accessible." : "Cannot inspect repository; check Git installation and repository access." },
    { name: "Ollama", passed: !!lp?.installed && lp.running, detail: !lp ? "Probe unavailable; check localBrain configuration." : !lp.installed ? "CLI unavailable; check Ollama installation." : !lp.running ? "Service unavailable; check the configured loopback endpoint." : "CLI detected; service reachable." },
    { name: "Local model", passed: !!lp?.preferredModel && lp.running && lp.models.includes(lp.preferredModel), detail: !lp ? "Cannot check model; check localBrain configuration." : !lp.preferredModel ? "Set localBrain.preferredModel or VIRAL_LOCAL_MODEL." : !lp.running ? "Cannot check installed model while Ollama is unavailable." : !lp.models.includes(lp.preferredModel) ? "Configured model is not installed; install it in Ollama." : "Configured model installed (availability probe only)." },
    { name: "Codex CLI", passed: !!cp?.installed && cp.usable === true, detail: !cp?.installed ? "CLI unavailable; check Codex installation and PATH." : cp.usable === true ? "Installed; subscription authentication confirmed." : cp.usable === null ? "Installed; authentication status unknown. Check codex login status." : "Installed; subscription authentication unavailable. Check codex login status." },
    { name: "Runtime storage", passed: storage.status === "fulfilled", detail: storage.status === "fulfilled" ? storage.value : "Storage check failed; check directory permissions and runtime snapshot validity." },
    { name: "Viral configuration", passed: configuration.status === "fulfilled", detail: configuration.status === "fulfilled" ? "Local brain, governor, and verification configuration valid." : "Invalid or unreadable viral-dev.config.json; check localBrain, efficiencyGovernor, and verificationCommands." }
  ];
  return { schemaVersion: 1, healthy: checks.every((check) => check.passed), checks };
}

export function formatHealthReport(report: HealthReport): string {
  return [`Viral doctor: ${report.healthy ? "healthy" : "needs attention"}`, ...report.checks.map((check) => `${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`)].join("\n");
}
