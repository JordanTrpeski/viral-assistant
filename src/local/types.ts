import type { ProcessRunner } from "../harness/types.js";

export type LocalModelProviderId = "ollama";
export type EscalationResult = "LOCAL_OK" | "CODING_HARNESS_REQUIRED" | "OWNER_INPUT_REQUIRED" | "UNSURE";

export interface LocalModelConfig {
  provider: LocalModelProviderId;
  baseUrl: string;
  preferredModel: string | null;
  defaultTimeoutMs: number;
}

export interface LocalModelProbe {
  provider: LocalModelProviderId;
  displayName: string;
  executable: string;
  installed: boolean;
  running: boolean;
  usable: boolean;
  version: string | null;
  models: string[];
  preferredModel: string | null;
  diagnostics: string[];
}

export interface LocalInferenceRequest {
  input: string;
  context?: Record<string, unknown>;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LocalInferenceResult {
  provider: LocalModelProviderId;
  model: string | null;
  succeeded: boolean;
  output: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  statusCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  error: string | null;
  diagnostics: string[];
}

export interface LocalModel {
  readonly id: LocalModelProviderId;
  readonly displayName: string;
  probe(): Promise<LocalModelProbe>;
  infer(request: LocalInferenceRequest): Promise<LocalInferenceResult>;
}

export interface LocalHttpRequest {
  url: string;
  method: "GET" | "POST";
  body?: string;
  signal: AbortSignal;
}

export interface LocalHttpResponse {
  status: number;
  body: string;
}

export interface LocalHttpTransport {
  request(request: LocalHttpRequest): Promise<LocalHttpResponse>;
}

export interface OllamaDependencies {
  processRunner: ProcessRunner;
  http: LocalHttpTransport;
  executable: string;
}

export interface LocalTaskResult<T> {
  succeeded: boolean;
  escalation: EscalationResult;
  value: T | null;
  inference: LocalInferenceResult | null;
  diagnostics: string[];
}
