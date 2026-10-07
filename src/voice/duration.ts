const unitMs: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

/** Parses human duration forms such as "30s", "2s", "500ms", or "1m30s" into milliseconds. */
export function parseDuration(value: string): number {
  const trimmed = value.trim();
  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let total = 0;
  let matchedLength = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(trimmed)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2] as string;
    total += amount * (unitMs[unit] ?? 0);
    matchedLength += match[0].length;
  }
  if (trimmed === "" || matchedLength !== trimmed.length) {
    throw new Error(`Invalid duration: "${value}". Use forms like 30s, 2s, or 500ms.`);
  }
  if (total <= 0) throw new Error(`Invalid duration: "${value}". Duration must be greater than zero.`);
  return Math.round(total);
}

export function formatDuration(ms: number): string {
  return ms % 1_000 === 0 ? `${ms / 1_000}s` : `${ms}ms`;
}
