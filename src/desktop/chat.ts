import { embedAnswers } from "../cli/interactive.js";
import type { ObjectiveOptions, ObjectiveSubmission, OwnerObjectiveService } from "../objective.js";
import type { ChatMessage, ChatRole, ChatState } from "./types.js";

export type ObjectiveSubmitter = Pick<OwnerObjectiveService, "submit">;

/**
 * Drives the chat/objective flow behind the desktop app's central chat panel: the owner types an
 * objective, the governed pipeline may come back with clarifying questions (see EFFICIENCY.md /
 * ObjectiveRefiner), and each free-text reply answers the oldest pending question and resubmits the
 * refined objective. This mirrors `refineInteractively` in `cli/interactive.ts` but is driven by
 * request/response calls from the HTTP daemon instead of a blocking console reader, so it fits a single
 * owner's desktop session rather than a TTY loop.
 */
export class DesktopChatSession {
  private objective = "";
  private taskId: string | null = null;
  private pending: string[] = [];
  private decision: ChatState["decision"] = null;
  private execution: ChatState["execution"] = null;
  private readonly messages: ChatMessage[] = [];

  constructor(private readonly objectives: ObjectiveSubmitter, private readonly now: () => Date = () => new Date()) {}

  private push(role: ChatRole, text: string): void {
    this.messages.push({ id: `msg-${this.messages.length + 1}`, role, text, createdAt: this.now().toISOString() });
  }

  private apply(result: ObjectiveSubmission): ChatState {
    this.taskId = result.taskId;
    this.decision = result.decision;
    this.execution = result.execution;
    this.pending = result.decision.action === "OWNER_INPUT_REQUIRED" ? (result.decision.clarifyingQuestions ?? []) : [];
    if (this.pending.length > 0) this.push("viral", this.pending[0]!);
    else if (result.execution) this.push("viral", result.execution.output ?? `${result.decision.tier} execution ${result.execution.succeeded ? "succeeded" : "failed"}.`);
    else this.push("viral", result.decision.reason);
    return this.snapshot();
  }

  /** True while the session is waiting on an owner reply to a clarifying question. */
  get awaitingAnswer(): boolean { return this.pending.length > 0; }

  async start(objective: string, options: ObjectiveOptions = {}): Promise<ChatState> {
    const trimmed = objective.trim();
    if (!trimmed) throw new Error("objective requires non-empty text");
    this.objective = trimmed;
    this.push("owner", trimmed);
    return this.apply(await this.objectives.submit(this.objective, options));
  }

  async answer(text: string, options: ObjectiveOptions = {}): Promise<ChatState> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("answer requires non-empty text");
    if (!this.awaitingAnswer) throw new Error("no pending clarifying question to answer");
    this.push("owner", trimmed);
    const question = this.pending[0]!;
    this.objective = embedAnswers(this.objective, new Map([[question, trimmed]]));
    return this.apply(await this.objectives.submit(this.objective, options));
  }

  snapshot(): ChatState {
    return { taskId: this.taskId, objective: this.objective, pendingQuestions: [...this.pending], decision: this.decision, execution: this.execution, messages: [...this.messages] };
  }
}
