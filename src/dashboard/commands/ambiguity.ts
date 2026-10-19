// A short, in-code map of ambiguous spending words to candidate category NAMES (by intent). Candidates that
// are not real categories in the live list are dropped at request time, so this never names a category that
// cannot be chosen. The model is run as usual; this rule only decides whether to ask before proposing.
import type { Category } from "../finance.js";

export const ambiguousWords: Readonly<Record<string, readonly string[]>> = {
  coffee: ["Entertainment", "Groceries", "Spending"],
  dinner: ["Entertainment", "Groceries"],
  lunch: ["Entertainment", "Groceries"],
  drinks: ["Entertainment", "Spending"],
  gift: ["Personal", "Spending"],
  snacks: ["Groceries", "Entertainment"]
};

export interface Ambiguity {
  word: string;
  candidates: string[];
}

function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack);
}

/**
 * The first ambiguous word in `text` that has at least one real candidate category — unless `text` already
 * names an existing category (then there is nothing to ask). Candidates are the mapped names that exist in
 * the live category list, in map order.
 */
export function findAmbiguity(text: string, categories: readonly Category[]): Ambiguity | null {
  const names = categories.map((category) => category.name);
  if (names.some((name) => hasWord(text, name))) return null;
  for (const [word, raw] of Object.entries(ambiguousWords)) {
    if (!hasWord(text, word)) continue;
    const candidates = raw.filter((candidate) => names.some((name) => name.toLowerCase() === candidate.toLowerCase()));
    if (candidates.length > 0) return { word, candidates };
  }
  return null;
}
