// Phase 5b: user-facing names for item kinds. The STORED kinds stay "task" and "reminder" (no data migration);
// only what the user sees changes. A task is shown as a "Deadline", a reminder as an "Event". Shared by the
// server (export headers) and the browser UI so the names never drift apart.

export function kindLabel(kind: string): string {
  if (kind === "task") return "Deadline";
  if (kind === "reminder") return "Event";
  return kind;
}

/** Plural form for headings. */
export function kindLabelPlural(kind: string): string {
  if (kind === "task") return "Deadlines";
  if (kind === "reminder") return "Events";
  return kind;
}
