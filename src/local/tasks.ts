import { deterministicEscalation, enforceEscalation } from "./policy.js";
import type { EscalationResult, LocalInferenceResult, LocalModel, LocalTaskResult } from "./types.js";

const escalationValues = new Set<EscalationResult>(["LOCAL_OK", "CODING_HARNESS_REQUIRED", "OWNER_INPUT_REQUIRED", "UNSURE"]);

export interface LocalTaskOptions { timeoutMs?: number; signal?: AbortSignal; model?: string; }
export interface Classification { escalation: EscalationResult; rationale: string; source: "policy" | "model"; }
export interface Summary { text: string; originalCharacters: number; summaryCharacters: number; }
export interface RelevantContext { selectedKeys: string[]; summary: string; packet: string; originalCharacters: number; packetCharacters: number; }
export interface RoutingRecommendation { escalation: EscalationResult; recommendation: string; source: "policy" | "model"; }

function structured(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function failed<T>(inference: LocalInferenceResult | null, diagnostic: string): LocalTaskResult<T> {
  return { succeeded: false, escalation: "UNSURE", value: null, inference, diagnostics: [diagnostic] };
}

function requestOptions(input: string, options: LocalTaskOptions, context?: Record<string, unknown>) {
  return { input, ...options, ...(context === undefined ? {} : { context }) };
}

export class LocalBrain {
  constructor(private readonly model: LocalModel) {}

  async classify(input: string, options: LocalTaskOptions = {}): Promise<LocalTaskResult<Classification>> {
    const policy = deterministicEscalation(input);
    if (policy) return { succeeded: true, escalation: policy, value: { escalation: policy, rationale: "Matched deterministic policy.", source: "policy" }, inference: null, diagnostics: [] };
    const inference = await this.model.infer(requestOptions(
      `Classify this request. Return only JSON with keys escalation and rationale. escalation must be LOCAL_OK, CODING_HARNESS_REQUIRED, OWNER_INPUT_REQUIRED, or UNSURE.\n\nRequest: ${input}`,
      options
    ));
    if (!inference.succeeded) return failed(inference, inference.error ?? "Classification inference failed.");
    const value = structured(inference.output);
    if (!value || typeof value.escalation !== "string" || !escalationValues.has(value.escalation as EscalationResult) || typeof value.rationale !== "string") {
      return failed(inference, "Local model returned malformed classification JSON.");
    }
    const escalation = enforceEscalation(input, value.escalation as EscalationResult);
    return { succeeded: true, escalation, value: { escalation, rationale: value.rationale, source: "model" }, inference, diagnostics: [] };
  }

  async summarize(input: string, context: Record<string, unknown> | undefined, options: LocalTaskOptions = {}): Promise<LocalTaskResult<Summary>> {
    const inference = await this.model.infer(requestOptions(
      "Summarize the supplied text concisely. Preserve decisions, blockers, current state, and next actions. Return plain text only.",
      options,
      { input, ...(context === undefined ? {} : { context }) }
    ));
    if (!inference.succeeded) return failed(inference, inference.error ?? "Summarization inference failed.");
    const text = inference.output.trim().slice(0, 4_000);
    if (!text) return failed(inference, "Local model returned an empty summary.");
    return {
      succeeded: true, escalation: "LOCAL_OK",
      value: { text, originalCharacters: input.length, summaryCharacters: text.length }, inference, diagnostics: []
    };
  }

  async selectRelevantContext(task: string, sections: Record<string, string>, options: LocalTaskOptions = {}): Promise<LocalTaskResult<RelevantContext>> {
    const originalCharacters = Object.values(sections).reduce((total, value) => total + value.length, 0);
    const inference = await this.model.infer(requestOptions(
      "Select only context relevant to the task. Return only JSON with selectedKeys (an array of supplied section names) and summary (a concise task-specific summary).",
      options,
      { task, sections }
    ));
    if (!inference.succeeded) return failed(inference, inference.error ?? "Context selection inference failed.");
    const value = structured(inference.output);
    if (!value || !Array.isArray(value.selectedKeys) || value.selectedKeys.some((key) => typeof key !== "string") || typeof value.summary !== "string") {
      return failed(inference, "Local model returned malformed context-selection JSON.");
    }
    const selectedKeys = [...new Set(value.selectedKeys as string[])].filter((key) => Object.hasOwn(sections, key)).slice(0, 12);
    if (selectedKeys.length === 0) return failed(inference, "Local model did not select any valid context sections.");
    const summary = value.summary.trim().slice(0, 2_000);
    const parts = [`# Local Context Packet`, "", `Task: ${task}`, "", "## Summary", summary, "", "## Relevant Context"];
    for (const key of selectedKeys) parts.push("", `### ${key}`, sections[key]!.slice(0, 3_000));
    const packet = parts.join("\n").slice(0, 8_000);
    return {
      succeeded: true, escalation: "LOCAL_OK",
      value: { selectedKeys, summary, packet, originalCharacters, packetCharacters: packet.length }, inference, diagnostics: []
    };
  }

  async recommendRoute(input: string, context: Record<string, unknown> | undefined, options: LocalTaskOptions = {}): Promise<LocalTaskResult<RoutingRecommendation>> {
    const policy = deterministicEscalation(input);
    if (policy) return { succeeded: true, escalation: policy, value: { escalation: policy, recommendation: "Route selected by deterministic policy.", source: "policy" }, inference: null, diagnostics: [] };
    const inference = await this.model.infer(requestOptions(
      `Recommend how to route this request. Return only JSON with escalation and recommendation. escalation must be LOCAL_OK, CODING_HARNESS_REQUIRED, OWNER_INPUT_REQUIRED, or UNSURE.\n\nRequest: ${input}`,
      options,
      context
    ));
    if (!inference.succeeded) return failed(inference, inference.error ?? "Routing inference failed.");
    const value = structured(inference.output);
    if (!value || typeof value.escalation !== "string" || !escalationValues.has(value.escalation as EscalationResult) || typeof value.recommendation !== "string") {
      return failed(inference, "Local model returned malformed routing JSON.");
    }
    const escalation = enforceEscalation(input, value.escalation as EscalationResult);
    return { succeeded: true, escalation, value: { escalation, recommendation: value.recommendation, source: "model" }, inference, diagnostics: [] };
  }
}
