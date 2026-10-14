// Fixed calendar colour categories, shared by the server and the browser UI.

export const colourCategories = ["bills", "income", "gym", "viral", "personal", "spending", "reminder"] as const;
export type ColourCategory = typeof colourCategories[number];

export const colourInfo: Record<ColourCategory, { label: string; colour: string }> = {
  bills: { label: "Bills", colour: "#f59e0b" },
  income: { label: "Income", colour: "#22c55e" },
  gym: { label: "Gym", colour: "#14b8a6" },
  viral: { label: "Viral", colour: "#a855f7" },
  personal: { label: "Personal", colour: "#ec4899" },
  spending: { label: "Spending", colour: "#3b82f6" },
  reminder: { label: "Reminder", colour: "#9ca3af" }
};

export function isColourCategory(value: unknown): value is ColourCategory {
  return typeof value === "string" && (colourCategories as readonly string[]).includes(value);
}
