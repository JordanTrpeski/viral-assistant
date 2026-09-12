import { useState, type FormEvent } from "react";
import type { ChatState } from "../types";

export interface ChatProps {
  chat: ChatState;
  onSendObjective: (objective: string) => Promise<void>;
  onSendAnswer: (text: string) => Promise<void>;
}

export function Chat({ chat, onSendObjective, onSendAnswer }: ChatProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const awaitingAnswer = chat.pendingQuestions.length > 0;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      if (chat.taskId && awaitingAnswer) await onSendAnswer(text);
      else await onSendObjective(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-slate-950">
      <header className="border-b border-slate-800 px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-100">
          Viral <span className="text-cyan-400">Desktop</span>
        </h1>
        <p className="text-xs text-slate-400">Tell Viral what to build. It will ask clarifying questions before it starts.</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {chat.messages.length === 0 && (
          <p className="text-sm text-slate-500">No objective yet — type one below to get started.</p>
        )}
        {chat.messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "owner" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${
                message.role === "owner"
                  ? "bg-purple-600/80 text-white"
                  : "border border-cyan-500/30 bg-slate-900 text-slate-100"
              }`}
            >
              {message.text}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="flex items-center gap-2 border-t border-slate-800 px-6 py-4">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={awaitingAnswer ? "Answer the question above…" : "Describe an objective…"}
          className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-md bg-gradient-to-r from-cyan-500 to-purple-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </section>
  );
}
