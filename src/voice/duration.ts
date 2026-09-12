const unitMultipliers: Record<string, number> = { ms: 1, s: 1_000, m: 60_000 };

export function parseDuration(input: string): number {
  const trimmed = input.trim();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(trimmed);
  if (!match) throw new Error(`Invalid duration "${input}"; expected a number followed by ms, s, or m (e.g. 30s, 2s, 500ms)`);
  const [, quantityText, unit] = match as unknown as [string, string, string];
  const multiplier = unitMultipliers[unit];
  if (multiplier === undefined) throw new Error(`Invalid duration unit in "${input}"`);
  const milliseconds = Number(quantityText) * multiplier;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new Error(`Invalid duration "${input}"; must be greater than zero`);
  return Math.round(milliseconds);
}
