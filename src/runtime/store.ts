import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeSnapshot, RuntimeStore } from "./types.js";
import { validateRuntimeSnapshot } from "./validation.js";

export class JsonRuntimeStore implements RuntimeStore {
  readonly path: string;

  constructor(private readonly directory: string) { this.path = join(directory, "state.json"); }

  async load(): Promise<RuntimeSnapshot | null> {
    let text: string;
    try { text = await readFile(this.path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`Cannot read runtime state: ${(error as Error).message}`);
    }
    try { return validateRuntimeSnapshot(JSON.parse(text) as unknown); }
    catch (error) { throw new Error(`Invalid runtime state at ${this.path}: ${(error as Error).message}`); }
  }

  async save(snapshot: RuntimeSnapshot): Promise<void> {
    const valid = validateRuntimeSnapshot(snapshot);
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}
