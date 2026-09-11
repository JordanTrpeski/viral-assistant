import type { EscalationResult } from "./types.js";

const ownerPatterns = [
  /\b(spend|pay|purchase|buy|transfer|send)\b.{0,30}\b(money|funds?|dollars?|euros?|payment)\b/i,
  /\b(delete permanently|irreversible|sign (?:a )?contract|accept legal|make an irreversible|consequential decision)\b/i
];
const codingPatterns = [
  /\b(implement|code|modify|refactor|debug|fix|build|rewrite|add|create)\b.{0,60}\b(code|feature|system|repository|architecture|authentication|database|api|command|cli|test)\b/i,
  /\b(new authentication architecture|change the architecture|edit the source|create a pull request)\b/i
];
const localPatterns = [
  /\b(summarize|summary|classify|explain|select relevant context)\b/i,
  /\b(next scheduled task|current project state)\b/i
];

export function deterministicEscalation(input: string): EscalationResult | null {
  if (ownerPatterns.some((pattern) => pattern.test(input))) return "OWNER_INPUT_REQUIRED";
  if (codingPatterns.some((pattern) => pattern.test(input))) return "CODING_HARNESS_REQUIRED";
  if (localPatterns.some((pattern) => pattern.test(input))) return "LOCAL_OK";
  return null;
}

export function enforceEscalation(input: string, recommendation: EscalationResult): EscalationResult {
  return deterministicEscalation(input) ?? recommendation;
}
