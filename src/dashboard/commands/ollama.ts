// Chat proposer backed by the loopback Ollama adapter (src/local). It turns one message into at most one
// RawProposal from the fixed action list, or falls back to a plain reply. It NEVER throws into the chat
// route and it does not validate: the existing plain-code validator is the only guardrail on a proposal.
import type { LocalModel } from "../../local/types.js";
import type { Category } from "../finance.js";
import { actionNames, actions, isActionName, type RawProposal } from "./actions.js";
import { placeholderReply, type Proposer, type ProposerInput, type ProposerResult } from "./proposer.js";

/** Reply used when the model cannot be reached (timeout or Ollama unavailable). */
export const unavailableReply = "Chat could not reach the model right now.";

export interface OllamaProposerConfig {
  model: string;
  timeoutMs: number;
}

/** Supplies the current category names per type; the proposer passes these to the model so it never invents one. */
export type CategoryProvider = () => Promise<readonly Category[]>;

function categoryLines(categories: readonly Category[]): string {
  const names = (kind: Category["kind"]): string => categories.filter((category) => category.kind === kind).map((category) => category.name).join(", ") || "(none)";
  return [`Fixed (bills): ${names("fixed")}`, `Flexible: ${names("flexible")}`, `Income: ${names("income")}`].join("\n");
}

function actionLines(): string {
  return actionNames.map((name) => {
    const definition = actions[name];
    const fields = Object.entries(definition.fields).map(([key, spec]) => `${key}${spec.required ? "" : "?"} (${spec.description})`).join("; ") || "no fields";
    return `- ${name}: ${definition.description} Fields: ${fields}`;
  }).join("\n");
}

/** The only input the model is given: the message, today, the action list, and the category names per type. */
export function buildPrompt(text: string, today: string, categories: readonly Category[]): string {
  return [
    "You convert one personal-finance message into a single structured command, or decline.",
    "Choose exactly one action from the list below, or use action \"none\" for anything that is not one of these commands (greetings, questions, small talk).",
    "Return JSON only — no prose, no markdown, no code fences — shaped exactly: {\"action\": \"<action name or none>\", \"fields\": { ... }}.",
    "Rules:",
    "- Never invent a category. Use only the exact category names listed for the matching type. If none fits, use \"none\".",
    "- Never invent a date. If the message states no date, omit the date field entirely; the system fills in today.",
    "- Amounts are plain JSON numbers in EUR (e.g. 12.5), never strings and never with a currency symbol.",
    "- add_expense and add_income are fixed by the action name; do not guess the direction.",
    "",
    `Today is ${today}.`,
    "",
    "Actions:",
    actionLines(),
    "",
    "Categories you may use, by type:",
    categoryLines(categories),
    "",
    `Message: ${text}`
  ].join("\n");
}

/** Qwen3 can wrap its answer in a <think>…</think> block and/or ```json fences; remove both before parsing. */
function stripReasoning(output: string): string {
  return output.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
}

function parseProposal(output: string): Record<string, unknown> | null {
  const cleaned = stripReasoning(output);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class OllamaProposer implements Proposer {
  constructor(private readonly model: LocalModel, private readonly config: OllamaProposerConfig, private readonly categories: CategoryProvider) {}

  async propose(input: ProposerInput): Promise<ProposerResult> {
    const categories = await this.categories();
    const prompt = buildPrompt(input.text, input.today, categories);
    const result = await this.model.infer({ input: prompt, model: this.config.model, timeoutMs: this.config.timeoutMs });
    if (!result.succeeded) {
      // Timeout or Ollama unavailable: a distinct reply, logged, no retry, never thrown.
      console.error(`[chat] Ollama proposer could not reach the model: ${result.error ?? "unknown error"}${result.timedOut ? " (timeout)" : ""}`);
      return { kind: "reply", text: unavailableReply };
    }
    const parsed = parseProposal(result.output);
    // Invalid JSON, no action, "none", or an action outside the list all fall back to the plain placeholder reply.
    if (!parsed || !isActionName(parsed.action)) return { kind: "reply", text: placeholderReply };
    const fields = typeof parsed.fields === "object" && parsed.fields !== null && !Array.isArray(parsed.fields) ? (parsed.fields as Record<string, unknown>) : {};
    const proposal: RawProposal = { action: parsed.action, fields };
    return { kind: "proposal", proposal };
  }
}
