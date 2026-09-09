import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJson(path: string): Promise<unknown> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) { throw new Error(`Cannot read required file ${path}: ${(error as Error).message}`); }
  try { return JSON.parse(text) as unknown; }
  catch (error) { throw new Error(`Malformed JSON in ${path}: ${(error as Error).message}`); }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

