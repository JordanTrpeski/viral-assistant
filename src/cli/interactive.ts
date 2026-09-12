import { createInterface } from "node:readline/promises";
import type { ObjectiveSubmission } from "../objective.js";

export const clarityThreshold = 0.6;
export const maxAnswerAttempts = 3;
export const maxRefinementRounds = 3;

/** An injectable console line reader so interactive flows can be driven by a mock in tests. */
export interface LineReader {
  question(prompt: string): Promise<string>;
  close(): void;
}

/** Default reader backed by the real stdin/stdout. */
export function consoleReader(): LineReader {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return { question: (prompt) => rl.question(prompt), close: () => rl.close() };
}

/** Reads a single line for the given prompt using a one-shot console reader. */
export async function readLine(prompt: string): Promise<string> {
  const reader = consoleReader();
  try { return (await reader.question(prompt)).trim(); }
  finally { reader.close(); }
}

export interface PromptDeps {
  reader: LineReader;
  validate: (question: string, answer: string) => number;
  print: (line: string) => void;
}

/**
 * Asks each clarifying question, reading the owner's answer and validating its clarity. A vague answer
 * is re-prompted up to maxAnswerAttempts times; the last answer is kept regardless so the flow always
 * terminates. Returns a map of question text → answer.
 */
export async function promptForAnswers(questions: string[], deps: PromptDeps): Promise<Map<string, string>> {
  const answers = new Map<string, string>();
  for (const question of questions) {
    deps.print(question);
    let answer = "";
    for (let attempt = 0; attempt < maxAnswerAttempts; attempt += 1) {
      answer = (await deps.reader.question("> ")).trim();
      if (!answer) { deps.print("  (an answer is required)"); continue; }
      if (deps.validate(question, answer) >= clarityThreshold) break;
      if (attempt < maxAnswerAttempts - 1) deps.print("  (that's a bit vague — please be more specific, e.g. a concrete name, number, or option)");
    }
    answers.set(question, answer);
  }
  return answers;
}

/** Appends the collected answers to the objective so the refiner can extract them on the next pass. */
export function embedAnswers(objective: string, answers: Map<string, string>): string {
  const values = [...answers.values()].map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) return objective;
  return `${objective.trim().replace(/\.\s*$/, "")}. ${values.join(", ")}`;
}

export interface RefineDeps extends PromptDeps {
  submit: (objective: string) => Promise<ObjectiveSubmission>;
  maxRounds?: number;
}

/**
 * Drives the interactive refinement loop: while the latest decision is OWNER_INPUT_REQUIRED with
 * clarifying questions, collect answers, embed them, and re-submit — up to maxRounds rounds — then
 * return the final submission.
 */
export async function refineInteractively(objective: string, first: ObjectiveSubmission, deps: RefineDeps): Promise<ObjectiveSubmission> {
  const rounds = deps.maxRounds ?? maxRefinementRounds;
  let result = first;
  let current = objective;
  for (let round = 0; round < rounds; round += 1) {
    const questions = result.decision.clarifyingQuestions ?? [];
    if (result.decision.action !== "OWNER_INPUT_REQUIRED" || questions.length === 0) break;
    const answers = await promptForAnswers(questions, deps);
    current = embedAnswers(current, answers);
    result = await deps.submit(current);
  }
  return result;
}
