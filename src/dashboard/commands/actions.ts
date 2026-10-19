// The chat command vocabulary. This list is the only thing a model may choose from; anything else is rejected.

export type FieldType = "amount" | "category" | "text" | "date" | "target" | "period";

export interface FieldSpec {
  type: FieldType;
  required: boolean;
  description: string;
}

export interface ActionDefinition {
  name: ActionName;
  description: string;
  fields: Readonly<Record<string, FieldSpec>>;
  /** Read-only actions are answered directly; writing actions always go through propose → confirm. */
  writes: boolean;
}

export const actionNames = ["add_expense", "add_income", "edit_transaction", "delete_transaction", "set_budget_target", "get_balance"] as const;
export type ActionName = typeof actionNames[number];

const amount = (required: boolean): FieldSpec => ({ type: "amount", required, description: "Amount in EUR, greater than 0 (rounded to cents)" });
const note: FieldSpec = { type: "text", required: false, description: "Short note, optional" };
const date: FieldSpec = { type: "date", required: false, description: "today, yesterday, tomorrow, a weekday name, or YYYY-MM-DD; defaults to today" };
const target: FieldSpec = { type: "target", required: true, description: "\"last\" (the latest transaction added in this chat) or a transaction id" };

export const actions: Readonly<Record<ActionName, ActionDefinition>> = {
  add_expense: {
    name: "add_expense", writes: true, description: "Record money spent (a Flexible expense, or a bill in a Fixed category).",
    fields: { amount: amount(true), category: { type: "category", required: true, description: "An existing Fixed or Flexible category" }, note, date }
  },
  add_income: {
    name: "add_income", writes: true, description: "Record money received in an Income category.",
    fields: { amount: amount(true), category: { type: "category", required: true, description: "An existing Income category" }, note, date }
  },
  edit_transaction: {
    name: "edit_transaction", writes: true, description: "Change the amount, category, note or date of one transaction.",
    fields: { target, amount: amount(false), category: { type: "category", required: false, description: "An existing category of the same type" }, note, date: { ...date, description: "New date; same forms as for adding" } }
  },
  delete_transaction: {
    name: "delete_transaction", writes: true, description: "Delete one transaction.",
    fields: { target }
  },
  set_budget_target: {
    name: "set_budget_target", writes: true, description: "Set the weekly or monthly target of a Flexible category.",
    fields: {
      category: { type: "category", required: true, description: "An existing Flexible category" },
      period: { type: "period", required: true, description: "\"week\" or \"month\"" },
      amount: amount(true)
    }
  },
  get_balance: {
    name: "get_balance", writes: false, description: "Report the current balance. Read-only.",
    fields: {}
  }
};

export function isActionName(value: unknown): value is ActionName {
  return typeof value === "string" && (actionNames as readonly string[]).includes(value);
}

/** What a model (or the test stub) proposes: an action name and raw, unvalidated fields. */
export interface RawProposal {
  action: unknown;
  fields?: unknown;
}
