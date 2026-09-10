import type { ProcessResult } from "../harness/types.js";
import { assertLoopbackUrl } from "./config.js";
import type {
  LocalHttpResponse, LocalInferenceRequest, LocalInferenceResult, LocalModel, LocalModelConfig,
  LocalModelProbe, OllamaDependencies
} from "./types.js";

interface OllamaTags { models?: Array<{ name?: unknown; model?: unknown }>; }
interface OllamaGeneration { response?: unknown; model?: unknown; }

function modelName(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const entry = value as Record<string, unknown>;
  return typeof entry.name === "string" ? entry.name : typeof entry.model === "string" ? entry.model : "";
}

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function processInstalled(result: ProcessResult): boolean {
  return result.exitCode === 0 && !result.timedOut && result.error === null;
}

function failure(started: number, model: string | null, details: Partial<LocalInferenceResult>): LocalInferenceResult {
  const finished = Date.now();
  return {
    provider: "ollama", model, succeeded: false, output: "",
    startedAt: new Date(started).toISOString(), finishedAt: new Date(finished).toISOString(), durationMs: finished - started,
    statusCode: null, timedOut: false, cancelled: false, error: "Local inference failed", diagnostics: [],
    ...details
  };
}

export class OllamaLocalModel implements LocalModel {
  readonly id = "ollama" as const;
  readonly displayName = "Ollama";
  private readonly config: LocalModelConfig;

  constructor(config: LocalModelConfig, private readonly dependencies: OllamaDependencies) {
    this.config = { ...config, baseUrl: assertLoopbackUrl(config.baseUrl) };
  }

  private async localRequest(path: string, method: "GET" | "POST", timeoutMs: number, body?: string, externalSignal?: AbortSignal): Promise<{ response: LocalHttpResponse | null; timedOut: boolean; cancelled: boolean; error: string | null }> {
    if (externalSignal?.aborted) return { response: null, timedOut: false, cancelled: true, error: "Request was already cancelled" };
    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const cancel = (): void => { cancelled = true; controller.abort(); };
    externalSignal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await this.dependencies.http.request({
        url: `${this.config.baseUrl}${path}`, method, ...(body === undefined ? {} : { body }), signal: controller.signal
      });
      return { response, timedOut, cancelled, error: null };
    } catch (error) {
      return { response: null, timedOut, cancelled, error: (error as Error).message };
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", cancel);
    }
  }

  async probe(): Promise<LocalModelProbe> {
    const diagnostics: string[] = [];
    const versionResult = await this.dependencies.processRunner.run({
      executable: this.dependencies.executable, args: ["--version"], cwd: process.cwd(), stdin: "", timeoutMs: 3_000
    });
    const installed = processInstalled(versionResult);
    const version = installed ? (versionResult.stdout || versionResult.stderr).trim() || null : null;
    if (!installed) diagnostics.push(versionResult.timedOut ? "Ollama CLI version probe timed out." : `Ollama CLI was not detected${versionResult.error ? `: ${versionResult.error}` : "."}`);

    const tags = await this.localRequest("/api/tags", "GET", 3_000);
    let running = false;
    let models: string[] = [];
    if (tags.response?.status === 200) {
      const parsed = jsonObject(tags.response.body) as OllamaTags | null;
      if (parsed && Array.isArray(parsed.models)) {
        running = true;
        models = [...new Set(parsed.models.map(modelName).filter(Boolean))].sort();
      } else diagnostics.push("Ollama tags response was malformed.");
    } else if (tags.timedOut) diagnostics.push("Ollama service probe timed out.");
    else if (tags.response) diagnostics.push(`Ollama service returned HTTP ${tags.response.status}.`);
    else diagnostics.push(`Ollama service is not reachable on the configured loopback endpoint${tags.error ? `: ${tags.error}` : "."}`);
    if (running && models.length === 0) diagnostics.push("Ollama is running but no models are installed; choose and install a suitable model manually.");
    if (this.config.preferredModel && !models.includes(this.config.preferredModel)) diagnostics.push(`Preferred model is not installed: ${this.config.preferredModel}`);
    return {
      provider: this.id, displayName: this.displayName, executable: this.dependencies.executable,
      installed, running, usable: running && models.length > 0 && (!this.config.preferredModel || models.includes(this.config.preferredModel)),
      version, models, preferredModel: this.config.preferredModel, diagnostics
    };
  }

  async infer(request: LocalInferenceRequest): Promise<LocalInferenceResult> {
    const started = Date.now();
    const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) return failure(started, null, { error: "timeoutMs must be an integer of at least 1000" });
    if (!request.input.trim()) return failure(started, null, { error: "input must be non-empty" });
    const model = request.model?.trim() || this.config.preferredModel;
    if (!model) return failure(started, null, { error: "No local model selected", diagnostics: ["Configure localBrain.preferredModel, set JARVIS_LOCAL_MODEL, or pass a model explicitly."] });
    let body: string;
    try {
      const prompt = request.context === undefined ? request.input : `${request.input}\n\nStructured context:\n${JSON.stringify(request.context)}`;
      body = JSON.stringify({ model, prompt, stream: false });
    } catch (error) {
      return failure(started, model, { error: "Structured context is not JSON-serializable", diagnostics: [(error as Error).message] });
    }
    const call = await this.localRequest("/api/generate", "POST", timeoutMs, body, request.signal);
    if (!call.response) {
      return failure(started, model, {
        timedOut: call.timedOut, cancelled: call.cancelled,
        error: call.cancelled ? "Local inference was cancelled" : call.timedOut ? "Local inference timed out" : "Ollama is unavailable",
        diagnostics: call.error ? [call.error] : []
      });
    }
    if (call.response.status < 200 || call.response.status >= 300) {
      return failure(started, model, { statusCode: call.response.status, error: `Ollama returned HTTP ${call.response.status}`, diagnostics: [call.response.body.slice(0, 500)] });
    }
    const parsed = jsonObject(call.response.body) as OllamaGeneration | null;
    if (!parsed || typeof parsed.response !== "string") return failure(started, model, { statusCode: call.response.status, error: "Ollama returned a malformed generation response" });
    const finished = Date.now();
    return {
      provider: this.id, model: typeof parsed.model === "string" ? parsed.model : model, succeeded: true, output: parsed.response,
      startedAt: new Date(started).toISOString(), finishedAt: new Date(finished).toISOString(), durationMs: finished - started,
      statusCode: call.response.status, timedOut: false, cancelled: false, error: null, diagnostics: []
    };
  }
}
