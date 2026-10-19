// How an Organise module describes itself. Model-ready, not model-connected: a model could only ever call these
// named actions with these fields; nothing calls them in this build.

export type ModuleFieldType = "text" | "date" | "enum" | "id" | "number" | "boolean" | "list";

export interface ModuleField {
  type: ModuleFieldType;
  required: boolean;
  description: string;
  /** For enum fields. */
  values?: readonly string[];
}

export interface ModuleAction {
  name: string;
  description: string;
  fieldSchema: Readonly<Record<string, ModuleField>>;
}

export interface OrganiseModule {
  /** The item type (or record kind) this module owns. */
  type: string;
  label: string;
  /** The item fields this module edits. */
  fields: readonly string[];
  /** Allowed statuses; null when the type has none or they come from elsewhere (lists). */
  statuses: readonly string[] | null;
  actions: readonly ModuleAction[];
}
