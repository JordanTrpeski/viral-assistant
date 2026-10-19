// Relative-amount arithmetic in code, not the model. Validation cannot catch a wrong-but-valid amount
// (the model computed 80 ÷ 4 = 12.50), so where a message states an arithmetic pattern the code evaluates it
// in integer cents and the result replaces the model's amount. "split X between N" is deliberately NOT
// calculated — it returns a question instead.
import { eurosToCents } from "./validate.js";

export type ArithmeticOutcome =
  | { kind: "value"; valueCents: number; working: string }
  | { kind: "needs-reference" }
  | { kind: "split"; amountCents: number }
  | null;

const referenceWords = new Set(["that", "that amount", "the last amount", "it"]);

/** euros for display: whole euros show without decimals, otherwise two places ("80", "3.33", "2.50"). */
function showEuros(cents: number): string {
  const value = cents / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function showNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

/** Resolves an operand token to cents: a number in EUR, or a reference to the last amount. */
function operandCents(token: string, lastAmountCents: number | null): number | "ref-missing" | null {
  const word = token.trim().toLowerCase().replace(/\s+/g, " ");
  if (referenceWords.has(word)) return lastAmountCents === null ? "ref-missing" : lastAmountCents;
  const number = Number(word);
  return Number.isFinite(number) ? eurosToCents(number) : null;
}

const operand = "(that amount|that|the last amount|it|\\d+(?:\\.\\d+)?)";
const splitRe = new RegExp(`\\bsplit\\s+${operand}\\s+(?:between|among)\\s+(\\d+(?:\\.\\d+)?)\\b`, "i");
const percentRe = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(?:percent|%)\\s+of\\s+${operand}\\b`, "i");
const halfRe = new RegExp(`\\bhalf\\s+(?:of\\s+)?${operand}\\b`, "i");
const doubleRe = new RegExp(`\\bdouble\\s+(?:of\\s+)?${operand}\\b`, "i");
const divideRe = new RegExp(`\\bdivide\\s+${operand}\\s+by\\s+(\\d+(?:\\.\\d+)?)\\b`, "i");
const dividedByRe = new RegExp(`\\b${operand}\\s+divided\\s+by\\s+(\\d+(?:\\.\\d+)?)\\b`, "i");
const slashRe = new RegExp(`\\b${operand}\\s*/\\s*(\\d+(?:\\.\\d+)?)\\b`, "i");

function divide(xToken: string, divisorToken: string, lastAmountCents: number | null): ArithmeticOutcome {
  const divisor = Number(divisorToken);
  if (!Number.isFinite(divisor) || divisor <= 0) return null;
  const x = operandCents(xToken, lastAmountCents);
  if (x === "ref-missing") return { kind: "needs-reference" };
  if (x === null) return null;
  const valueCents = Math.round(x / divisor);
  return { kind: "value", valueCents, working: `${showEuros(x)} ÷ ${showNumber(divisor)} = ${showEuros(valueCents)}` };
}

/**
 * Recognises the supported patterns and returns the result in cents with a short working string, a request
 * for the missing reference, or the share-or-total split question. Returns null when no pattern is present.
 */
export function evaluateArithmetic(text: string, lastAmountCents: number | null): ArithmeticOutcome {
  const split = splitRe.exec(text);
  if (split) {
    const x = operandCents(split[1]!, lastAmountCents);
    if (x === "ref-missing") return { kind: "needs-reference" };
    if (x === null) return null;
    return { kind: "split", amountCents: x };
  }

  const percent = percentRe.exec(text);
  if (percent) {
    const rate = Number(percent[1]);
    const y = operandCents(percent[2]!, lastAmountCents);
    if (y === "ref-missing") return { kind: "needs-reference" };
    if (y === null || !Number.isFinite(rate)) return null;
    const valueCents = Math.round((y * rate) / 100);
    return { kind: "value", valueCents, working: `${showNumber(rate)}% of ${showEuros(y)} = ${showEuros(valueCents)}` };
  }

  const half = halfRe.exec(text);
  if (half) {
    const x = operandCents(half[1]!, lastAmountCents);
    if (x === "ref-missing") return { kind: "needs-reference" };
    if (x === null) return null;
    const valueCents = Math.round(x / 2);
    return { kind: "value", valueCents, working: `half of ${showEuros(x)} = ${showEuros(valueCents)}` };
  }

  const twice = doubleRe.exec(text);
  if (twice) {
    const x = operandCents(twice[1]!, lastAmountCents);
    if (x === "ref-missing") return { kind: "needs-reference" };
    if (x === null) return null;
    const valueCents = x * 2;
    return { kind: "value", valueCents, working: `double ${showEuros(x)} = ${showEuros(valueCents)}` };
  }

  const divideMatch = divideRe.exec(text) ?? dividedByRe.exec(text) ?? slashRe.exec(text);
  if (divideMatch) return divide(divideMatch[1]!, divideMatch[2]!, lastAmountCents);

  return null;
}
