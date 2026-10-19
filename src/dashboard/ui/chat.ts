// Text chat pane for the Overview: threads, messages, composer and expand toggle. No model: replies are a placeholder.
import type { ChatMessageView, ChatThreadSummary, ConfirmResult } from "../chat.js";
import { api, save, type AppContext } from "./api.js";
import { focusKey, h } from "./dom.js";

const expandedKey = "viral.chat.expanded";
const state: { threadId: string; draft: string; creating: boolean; renamingId: string | null; sending: boolean; undo: { token: string; proposalId: string; expiresAt: number } | null } = {
  threadId: "main", draft: "", creating: false, renamingId: null, sending: false, undo: null
};

/** Expanded state is a per-browser preference; the pane works normally if storage is unavailable. */
function storedExpanded(): boolean {
  try { return localStorage.getItem(expandedKey) === "true"; }
  catch { return false; }
}

function setExpanded(value: boolean): void {
  try { localStorage.setItem(expandedKey, String(value)); }
  catch { /* storage unavailable: the choice lasts until the page reloads */ }
  memoryExpanded = value;
}

let memoryExpanded: boolean | null = null;

export function isChatExpanded(): boolean {
  return memoryExpanded ?? storedExpanded();
}

function nameInput(context: AppContext, key: string, initial: string, onSubmit: (name: string) => Promise<void>, onCancel: () => void): HTMLInputElement {
  let done = false;
  const finish = (input: HTMLInputElement): void => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (!name || name === initial) { onCancel(); void context.refresh(); return; }
    void onSubmit(name);
  };
  return h("input", {
    ...focusKey(key), class: "thread-name-input", maxlength: 40, value: initial, placeholder: "Thread name", "aria-label": "Thread name",
    onkeydown: (event: KeyboardEvent) => {
      const input = event.target as HTMLInputElement;
      if (event.key === "Enter") { event.preventDefault(); finish(input); }
      if (event.key === "Escape") { done = true; onCancel(); void context.refresh(); }
    },
    onblur: (event: Event) => finish(event.target as HTMLInputElement)
  });
}

function threadTab(context: AppContext, thread: ChatThreadSummary): HTMLElement {
  const active = thread.id === state.threadId;
  if (state.renamingId === thread.id) {
    return h("span", { class: "thread-tab active" }, nameInput(context, `rename:${thread.id}`, thread.name,
      (name) => save(context, async () => { state.renamingId = null; await api("PATCH", `/api/chat/threads/${thread.id}`, { name }); }),
      () => { state.renamingId = null; }));
  }
  return h("span", { class: `thread-tab${active ? " active" : ""}` },
    h("button", {
      class: "thread-select", "aria-pressed": String(active), title: thread.main ? "Main thread" : "Double-click to rename",
      onclick: () => { state.threadId = thread.id; void context.refresh(); },
      ondblclick: () => { if (!thread.main) { state.renamingId = thread.id; void context.refresh().then(() => document.querySelector<HTMLInputElement>(`[data-focus="rename:${thread.id}"]`)?.select()); } }
    }, thread.name),
    active && !thread.main ? h("button", { class: "thread-action", title: "Rename thread", "aria-label": `Rename ${thread.name}`, onclick: () => { state.renamingId = thread.id; void context.refresh().then(() => document.querySelector<HTMLInputElement>(`[data-focus="rename:${thread.id}"]`)?.select()); } }, "✎") : null,
    active && !thread.main ? h("button", {
      class: "thread-action danger", title: "Delete thread", "aria-label": `Delete ${thread.name}`,
      onclick: () => save(context, async () => { await api("DELETE", `/api/chat/threads/${thread.id}`); state.threadId = "main"; })
    }, "✕") : null);
}

/** Confirm / Cancel for a pending proposal: the only way chat writes data. */
function proposalControls(context: AppContext, message: ChatMessageView): HTMLElement | null {
  const proposal = message.proposal;
  if (!proposal || message.kind !== "proposal") return null;
  if (proposal.status !== "pending") return h("div", { class: `proposal-status status-${proposal.status}` }, proposal.status === "expired" ? "Expired — send the request again" : proposal.status[0]!.toUpperCase() + proposal.status.slice(1));
  return h("div", { class: "proposal-actions" },
    h("button", {
      class: "primary", onclick: () => save(context, async () => {
        const result = await api<ConfirmResult>("POST", `/api/chat/proposals/${proposal.id}/confirm`);
        state.undo = { token: result.undo.token, proposalId: proposal.id, expiresAt: Date.parse(result.undo.expiresAt) };
        window.setTimeout(() => { if (state.undo?.token === result.undo.token) { state.undo = null; void context.refresh(); } }, Math.max(0, Date.parse(result.undo.expiresAt) - Date.now()));
      })
    }, "Confirm"),
    h("button", { onclick: () => save(context, () => api("POST", `/api/chat/proposals/${proposal.id}/cancel`)) }, "Cancel"));
}

function undoControl(context: AppContext, message: ChatMessageView): HTMLElement | null {
  const undo = state.undo;
  if (!undo || message.kind !== "result" || message.proposalId !== undo.proposalId || !message.text.startsWith("Done:") || Date.now() > undo.expiresAt) return null;
  return h("div", { class: "proposal-actions" }, h("button", {
    onclick: () => save(context, async () => { state.undo = null; await api("POST", `/api/chat/undo/${undo.token}`); })
  }, "Undo"));
}

function messageBubble(context: AppContext, message: ChatMessageView): HTMLElement {
  return h("div", { class: `message ${message.role === "user" ? "from-user" : "from-reply"} kind-${message.kind}` },
    h("div", { class: "bubble" }, message.text, proposalControls(context, message), undoControl(context, message)),
    h("div", { class: "message-time" }, new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
}

async function send(context: AppContext): Promise<void> {
  const text = state.draft.trim();
  if (!text || state.sending) return;
  state.sending = true;
  try {
    await api("POST", `/api/chat/threads/${state.threadId}/messages`, { text });
    state.draft = "";
  } catch (error) {
    context.notify((error as Error).message);
  } finally {
    state.sending = false;
  }
  await context.refresh();
}

export async function renderChat(context: AppContext): Promise<HTMLElement> {
  const threads = await api<ChatThreadSummary[]>("GET", "/api/chat/threads");
  if (!threads.some((thread) => thread.id === state.threadId)) state.threadId = "main";
  const messages = await api<ChatMessageView[]>("GET", `/api/chat/threads/${state.threadId}/messages`);
  const expanded = isChatExpanded();
  const list = h("div", { class: "message-list", role: "log", "aria-live": "polite" },
    ...messages.map((message) => messageBubble(context, message)),
    messages.length ? null : h("p", { class: "muted small empty-chat" }, "No messages in this thread yet."));
  const input = h("textarea", {
    ...focusKey("chat-input"), class: "chat-input", rows: 2, maxlength: 2000, placeholder: "Message (Enter to send, Shift+Enter for a new line)", value: state.draft,
    oninput: (event: Event) => { state.draft = (event.target as HTMLTextAreaElement).value; },
    onkeydown: (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void send(context);
      }
    }
  });
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  return h("section", { class: `panel chat${expanded ? " expanded" : ""}`, "aria-label": "Chat" },
    h("div", { class: "chat-head" },
      h("div", { class: "thread-tabs", role: "tablist" },
        ...threads.map((thread) => threadTab(context, thread)),
        state.creating
          ? h("span", { class: "thread-tab active" }, nameInput(context, "new-thread", "",
            (name) => save(context, async () => {
              state.creating = false;
              const created = await api<ChatThreadSummary>("POST", "/api/chat/threads", { name });
              state.threadId = created.id;
            }),
            () => { state.creating = false; }))
          : h("button", { class: "thread-new", onclick: () => { state.creating = true; void context.refresh().then(() => document.querySelector<HTMLElement>("[data-focus='new-thread']")?.focus()); } }, "+ New")),
      h("button", {
        class: "chat-expand", "aria-pressed": String(expanded), title: expanded ? "Collapse chat" : "Expand chat", "aria-label": expanded ? "Collapse chat" : "Expand chat",
        onclick: () => { setExpanded(!expanded); void context.refresh(); }
      }, expanded ? "Collapse" : "Expand")),
    h("p", { class: "chat-note muted small" }, "Kept until you delete it. Retention rule not decided yet."),
    list,
    h("div", { class: "composer" }, input, h("button", { class: "primary", disabled: state.sending, onclick: () => send(context) }, "Send")));
}
