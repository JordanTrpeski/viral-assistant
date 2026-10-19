// The list of Organise modules. Adding a module means adding it here; the Overview reads this list.
import { remindersModule } from "./reminders.js";
import { tasksModule } from "./tasks.js";
import type { OrganiseModule } from "./types.js";

export const organiseModules: readonly OrganiseModule[] = [tasksModule, remindersModule];
