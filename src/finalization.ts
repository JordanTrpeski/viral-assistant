import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { generateCheckpoint } from "./checkpoint.js";
import { readJson, writeJson } from "./files.js";
import { loadState, saveState } from "./state.js";
import { readTask, updateTask } from "./tasks.js";
import type { DevelopmentTask, VerificationReport } from "./types.js";

const exec = promisify(execFile);
const ownerName = "Jordan Trpeski";
const ownerEmail = "102552864+JordanTrpeski@users.noreply.github.com";
const publicationBlocker = "Publication failed";

export type FinalizationPhase = "IMPLEMENTATION_COMMITTED" | "IMPLEMENTATION_PUSHED" | "COMPLETION_COMMITTED" | "COMPLETED";

export interface FinalizationRecord {
  schemaVersion: 1;
  taskId: string;
  branch: string;
  phase: FinalizationPhase;
  implementationCommit: string;
  completionCommit: string | null;
  completionAt: string;
  lastError: string | null;
}

export interface FinalizationResult {
  taskId: string;
  succeeded: boolean;
  phase: FinalizationPhase | "NOT_STARTED";
  branch: string | null;
  implementationCommit: string | null;
  completionCommit: string | null;
  diagnostic: string;
}

export interface GitPublisher {
  branch(): Promise<string>;
  head(): Promise<string>;
  isDirty(): Promise<boolean>;
  identity(): Promise<{ name: string; email: string }>;
  remoteUrl(): Promise<string>;
  preflightPush(branch: string): Promise<void>;
  stageAll(): Promise<void>;
  hasStagedChanges(): Promise<boolean>;
  commit(message: string): Promise<string>;
  push(branch: string): Promise<void>;
}

interface GitFailure extends Error { stdout?: string; stderr?: string; }

function diagnostic(error: unknown): string {
  const failure = error as GitFailure;
  return (failure.stderr?.trim() || failure.stdout?.trim() || failure.message || String(error)).slice(0, 2_000);
}

export class NodeGitPublisher implements GitPublisher {
  constructor(private readonly root: string) {}

  private async run(args: string[]): Promise<string> {
    const { stdout } = await exec("git", ["-c", `safe.directory=${this.root}`, ...args], { cwd: this.root, encoding: "utf8", windowsHide: true });
    return stdout.trim();
  }

  async branch(): Promise<string> { return await this.run(["branch", "--show-current"]); }
  async head(): Promise<string> { return await this.run(["rev-parse", "HEAD"]); }
  async isDirty(): Promise<boolean> { return (await this.run(["status", "--porcelain=v1"])).length > 0; }
  async identity(): Promise<{ name: string; email: string }> {
    return { name: await this.run(["config", "--local", "--get", "user.name"]), email: await this.run(["config", "--local", "--get", "user.email"]) };
  }
  async remoteUrl(): Promise<string> { return await this.run(["remote", "get-url", "--push", "origin"]); }
  async preflightPush(branch: string): Promise<void> { await this.run(["push", "--dry-run", "origin", `HEAD:refs/heads/${branch}`]); }
  async stageAll(): Promise<void> { await this.run(["add", "--all"]); }
  async hasStagedChanges(): Promise<boolean> {
    try { await this.run(["diff", "--cached", "--quiet"]); return false; }
    catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 1) return true;
      throw error;
    }
  }
  async commit(message: string): Promise<string> {
    await this.run(["commit", "-m", message]);
    return await this.head();
  }
  async push(branch: string): Promise<void> { await this.run(["push", "origin", `HEAD:refs/heads/${branch}`]); }
}

function verifyReport(value: unknown): VerificationReport {
  const report = value as VerificationReport;
  if (report?.schemaVersion !== 1 || report.passed !== true || !Array.isArray(report.results) || report.results.length === 0 || report.results.some((item) => item.passed !== true)) {
    throw new Error("Finalization requires a passing, non-empty verification/latest.json report.");
  }
  return report;
}

function gated(task: DevelopmentTask): boolean {
  return task.notes.some((note) => /Efficiency selection:\s*OWNER_INPUT_REQUIRED/i.test(note));
}

function expectedRemote(url: string): boolean {
  return /github\.com[/:]JordanTrpeski\/viral-assistant(?:\.git)?$/i.test(url);
}

export class DevelopmentFinalizer {
  private readonly journalPath: string;

  constructor(
    private readonly root: string,
    private readonly git: GitPublisher = new NodeGitPublisher(root),
    dataDirectory = resolve(root, ".viral", "finalization"),
    private readonly now: () => Date = () => new Date()
  ) {
    this.journalPath = resolve(dataDirectory);
  }

  private recordPath(taskId: string): string { return join(this.journalPath, `${taskId}.json`); }

  private async loadRecord(taskId: string): Promise<FinalizationRecord | null> {
    try { return await readJson(this.recordPath(taskId)) as FinalizationRecord; }
    catch (error) {
      if ((error as Error).message.includes("ENOENT")) return null;
      throw error;
    }
  }

  private async saveRecord(record: FinalizationRecord): Promise<void> { await writeJson(this.recordPath(record.taskId), record); }

  private result(record: FinalizationRecord | null, succeeded: boolean, diagnosticText: string): FinalizationResult {
    return {
      taskId: record?.taskId ?? "unknown",
      succeeded,
      phase: record?.phase ?? "NOT_STARTED",
      branch: record?.branch ?? null,
      implementationCommit: record?.implementationCommit ?? null,
      completionCommit: record?.completionCommit ?? null,
      diagnostic: diagnosticText
    };
  }

  private async block(taskId: string, reason: string): Promise<void> {
    const task = await readTask(this.root, taskId);
    await updateTask(this.root, taskId, { status: "blocked", notes: task.notes.includes(reason) ? task.notes : [...task.notes, reason], nextAction: reason });
    const state = await loadState(this.root);
    await saveState(this.root, {
      ...state,
      activeTask: taskId,
      completedTasks: state.completedTasks.filter((id) => id !== taskId),
      blockers: [...state.blockers.filter((item) => !item.startsWith(publicationBlocker)), reason],
      nextAction: reason
    });
  }

  private async prepareCompletion(record: FinalizationRecord, report: VerificationReport, checkpoint: boolean): Promise<void> {
    const task = await readTask(this.root, record.taskId);
    const note = `Verified implementation committed as ${record.implementationCommit} and pushed to origin/${record.branch}.`;
    await updateTask(this.root, record.taskId, {
      status: "complete",
      verificationResult: report,
      notes: task.notes.includes(note) ? task.notes : [...task.notes.filter((item) => !item.startsWith(publicationBlocker)), note],
      nextAction: "Objective completed after verified changes were committed and pushed."
    });
    const state = await loadState(this.root);
    await saveState(this.root, {
      ...state,
      activeTask: null,
      completedTasks: state.completedTasks.includes(record.taskId) ? state.completedTasks : [...state.completedTasks, record.taskId],
      blockers: state.blockers.filter((item) => !item.startsWith(publicationBlocker) && !item.startsWith("Publication blocked")),
      lastVerifiedCommit: record.implementationCommit,
      lastCheckpoint: "CHECKPOINT.md",
      nextAction: "Await the owner's next approved objective. Do not merge main or start M05."
    });
    if (checkpoint) await generateCheckpoint(this.root);
  }

  async finalize(taskId: string): Promise<FinalizationResult> {
    if (!/^[A-Za-z0-9_-]+$/.test(taskId)) throw new Error(`Invalid task id: ${taskId}`);
    const task = await readTask(this.root, taskId);
    if (gated(task)) throw new Error(`Task ${taskId} requires owner input and cannot be finalized automatically.`);
    const report = verifyReport(await readJson(join(this.root, "verification", "latest.json")));
    const branch = await this.git.branch();
    if (!branch || branch === "main") throw new Error("Automatic finalization requires a checked-out development branch; main is owner-gated.");
    const identity = await this.git.identity();
    if (identity.name !== ownerName || identity.email !== ownerEmail) throw new Error(`Git identity must be ${ownerName} <${ownerEmail}> before finalization.`);
    const remote = await this.git.remoteUrl();
    if (!expectedRemote(remote)) throw new Error("origin must be the owner repository JordanTrpeski/viral-assistant before finalization.");

    let record = await this.loadRecord(taskId);
    if (record && record.branch !== branch) throw new Error(`Finalization journal belongs to branch ${record.branch}, not ${branch}.`);
    if (record?.phase === "COMPLETED") return this.result(record, true, "Verified changes and completion state are already committed and pushed.");

    if (!record) {
      await this.git.preflightPush(branch);
      if (!await this.git.isDirty()) throw new Error("Finalization found no verified working-tree changes to commit.");
      const current = await readTask(this.root, taskId);
      if (current.status === "complete") await updateTask(this.root, taskId, { status: "in_progress", nextAction: "Commit and push the verified implementation." });
      const state = await loadState(this.root);
      if (state.completedTasks.includes(taskId)) await saveState(this.root, { ...state, activeTask: taskId, completedTasks: state.completedTasks.filter((id) => id !== taskId) });
      await this.git.stageAll();
      if (!await this.git.hasStagedChanges()) throw new Error("Finalization found no verified changes after staging.");
      const implementationCommit = await this.git.commit(`feat: complete ${taskId} implementation`);
      record = { schemaVersion: 1, taskId, branch, phase: "IMPLEMENTATION_COMMITTED", implementationCommit, completionCommit: null, completionAt: this.now().toISOString(), lastError: null };
      await this.saveRecord(record);
    }

    if (record.phase === "IMPLEMENTATION_COMMITTED") {
      try { await this.git.push(branch); }
      catch (error) {
        const reason = `${publicationBlocker} after commit ${record.implementationCommit}: ${diagnostic(error)}`;
        record = { ...record, lastError: reason };
        await this.saveRecord(record);
        await this.block(taskId, reason);
        return this.result(record, false, reason);
      }
      record = { ...record, phase: "IMPLEMENTATION_PUSHED", lastError: null };
      await this.saveRecord(record);
    }

    if (record.phase === "IMPLEMENTATION_PUSHED") {
      await this.prepareCompletion(record, report, true);
      await this.git.stageAll();
      const completionCommit = await this.git.hasStagedChanges()
        ? await this.git.commit(`docs: finalize ${taskId} lifecycle`)
        : await this.git.head();
      record = { ...record, phase: "COMPLETION_COMMITTED", completionCommit, lastError: null };
      await this.saveRecord(record);
    }

    if (record.phase === "COMPLETION_COMMITTED") {
      try { await this.git.push(branch); }
      catch (error) {
        const reason = `${publicationBlocker} for completion commit ${record.completionCommit}: ${diagnostic(error)}`;
        record = { ...record, lastError: reason };
        await this.saveRecord(record);
        await this.block(taskId, reason);
        return this.result(record, false, reason);
      }
      await this.prepareCompletion(record, report, false);
      record = { ...record, phase: "COMPLETED", lastError: null };
      await this.saveRecord(record);
    }

    return this.result(record, true, `Task ${taskId} is complete; verified implementation and lifecycle state were pushed to origin/${branch}.`);
  }
}
