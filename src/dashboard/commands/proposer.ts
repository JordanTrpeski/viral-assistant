// Where proposals come from. No model is connected in this step: the default proposer only ever replies
// with the placeholder text, and tests inject a stub that returns whatever proposal they need.
import type { RawProposal } from "./actions.js";

export type ProposerResult = { kind: "reply"; text: string } | { kind: "proposal"; proposal: RawProposal };

export interface ProposerInput {
  threadId: string;
  text: string;
  today: string;
}

export interface Proposer {
  propose(input: ProposerInput): Promise<ProposerResult>;
}

export const placeholderReply = "Chat is not connected to a model yet.";

/** The production default until a model is connected: never proposes anything. */
export class PlaceholderProposer implements Proposer {
  async propose(): Promise<ProposerResult> {
    return { kind: "reply", text: placeholderReply };
  }
}

/** Test stub: returns the proposal (or reply) currently set on it, and records what it was asked. */
export class StubProposer implements Proposer {
  readonly calls: ProposerInput[] = [];

  constructor(public next: ProposerResult = { kind: "reply", text: placeholderReply }) {}

  propose(input: ProposerInput): Promise<ProposerResult> {
    this.calls.push(input);
    return Promise.resolve(structuredClone(this.next));
  }

  proposeNext(proposal: RawProposal): this {
    this.next = { kind: "proposal", proposal };
    return this;
  }
}
