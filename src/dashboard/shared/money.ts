// Pure money helpers shared by the server and the browser UI. All amounts are integer cents.

export function isPositiveCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Parses a euro amount typed by a person ("12", "12.5", "12,50", "€ 1 234.56") into integer cents, or null. */
export function parseEuroToCents(input: string): number | null {
  const cleaned = input.replace(/[€\s]/g, "").replace(",", ".");
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  if (!Number.isSafeInteger(cents)) return null;
  return match[1] ? -cents : cents;
}

/** Formats integer cents as euros, e.g. 123456 -> "€1,234.56" and -500 -> "-€5.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % 100).toString().padStart(2, "0");
  return `${sign}€${whole}.${fraction}`;
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
