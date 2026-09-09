import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitState } from "./types.js";

const run = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", ["-c", `safe.directory=${root}`, ...args], { cwd: root, encoding: "utf8" });
    return stdout.trimEnd();
  } catch (error) {
    throw new Error(`Git inspection failed (${args.join(" ")}): ${(error as Error).message}`);
  }
}

export async function inspectGit(root: string): Promise<GitState> {
  const [branch, head, porcelain] = await Promise.all([
    git(root, ["branch", "--show-current"]),
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["status", "--porcelain=v1"])
  ]);
  const changedFiles = porcelain === "" ? [] : porcelain.split(/\r?\n/).map((line) => line.slice(3));
  return { branch: branch.trim() || "DETACHED", head: head.trim(), workingTreeStatus: changedFiles.length ? "dirty" : "clean", changedFiles };
}
