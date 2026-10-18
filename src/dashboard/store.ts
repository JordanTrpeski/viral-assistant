import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { dirname } from "node:path";

/** The file operations the store needs; injectable so tests can simulate a failed write. */
export interface StoreFileSystem {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  unlink(path: string): Promise<void>;
}

/** Writes JSON atomically: a uniquely named temp file in the same directory, then rename over the target. */
export async function writeJsonAtomic(path: string, value: unknown, fs: StoreFileSystem = nodeFs): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, path);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/**
 * One JSON document owned by this process. Reads are served from memory after the first load; updates are
 * serialized, applied to a copy, written atomically, and only then become visible. A failed update leaves
 * both the file and the in-memory document unchanged.
 */
export class JsonDocumentStore<T> {
  private cache: T | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly path: string,
    private readonly validate: (value: unknown) => T,
    private readonly initial: () => T,
    private readonly fs: StoreFileSystem = nodeFs
  ) {}

  private async load(): Promise<T> {
    if (this.cache !== undefined) return this.cache;
    let text: string;
    try { text = await this.fs.readFile(this.path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Cannot read ${this.path}: ${(error as Error).message}`);
      this.cache = this.initial();
      return this.cache;
    }
    try { this.cache = this.validate(JSON.parse(text) as unknown); }
    catch (error) { throw new Error(`Invalid data in ${this.path}: ${(error as Error).message}`); }
    return this.cache;
  }

  async read(): Promise<T> {
    await this.queue.catch(() => undefined);
    return structuredClone(await this.load());
  }

  update<R>(change: (document: T) => R): Promise<R> {
    const run = async (): Promise<R> => {
      const draft = structuredClone(await this.load());
      const result = change(draft);
      await writeJsonAtomic(this.path, draft, this.fs);
      this.cache = draft;
      return structuredClone(result);
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Deletes the file (after any pending update) and forgets the cached document. A missing file is fine. */
  remove(): Promise<void> {
    const run = async (): Promise<void> => {
      await this.fs.unlink(this.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      this.cache = undefined;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
