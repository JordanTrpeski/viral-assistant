import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatState, DesktopServerEvent, DesktopTaskSummary, DiagnosticsSnapshot } from "../types";

const emptyChat: ChatState = { taskId: null, objective: "", pendingQuestions: [], decision: null, execution: null, messages: [] };

function daemonUrls(): { httpBase: string; wsBase: string } {
  if (window.viralDaemon) return window.viralDaemon;
  // Falls back to the default dev port when running the renderer outside Electron (e.g. `vite dev` alone).
  return { httpBase: "http://127.0.0.1:4173", wsBase: "ws://127.0.0.1:4173/ws" };
}

export interface DaemonConnection {
  connected: boolean;
  chat: ChatState;
  tasks: DesktopTaskSummary[];
  diagnostics: DiagnosticsSnapshot | null;
  sendObjective(objective: string): Promise<void>;
  sendAnswer(text: string): Promise<void>;
  error: string | null;
}

/** Owns the daemon connection for the whole app: an initial REST fetch for each panel, then a
 *  WebSocket subscription that keeps chat/tasks/diagnostics live without polling. */
export function useDaemon(): DaemonConnection {
  const { httpBase, wsBase } = daemonUrls();
  const [connected, setConnected] = useState(false);
  const [chat, setChat] = useState<ChatState>(emptyChat);
  const [tasks, setTasks] = useState<DesktopTaskSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [chatResponse, tasksResponse, diagnosticsResponse] = await Promise.all([
          fetch(`${httpBase}/api/chat`),
          fetch(`${httpBase}/api/tasks`),
          fetch(`${httpBase}/api/diagnostics`)
        ]);
        if (cancelled) return;
        setChat(await chatResponse.json() as ChatState);
        setTasks(await tasksResponse.json() as DesktopTaskSummary[]);
        setDiagnostics(await diagnosticsResponse.json() as DiagnosticsSnapshot);
      } catch (fetchError) {
        if (!cancelled) setError((fetchError as Error).message);
      }
    })();

    const socket = new WebSocket(wsBase);
    socketRef.current = socket;
    socket.addEventListener("open", () => setConnected(true));
    socket.addEventListener("close", () => setConnected(false));
    socket.addEventListener("error", () => setError("WebSocket connection to the Viral daemon failed."));
    socket.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(message.data as string) as DesktopServerEvent;
        if (event.type === "chat") setChat(event.chat);
        else if (event.type === "tasks") setTasks(event.tasks);
        else setDiagnostics(event.diagnostics);
      } catch { /* ignore malformed frames */ }
    });

    return () => { cancelled = true; socket.close(); };
  }, [httpBase, wsBase]);

  const sendObjective = useCallback(async (objective: string) => {
    const response = await fetch(`${httpBase}/api/chat/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objective }) });
    if (!response.ok) { setError(((await response.json()) as { error?: string }).error ?? "Failed to submit objective."); return; }
    setChat(await response.json() as ChatState);
  }, [httpBase]);

  const sendAnswer = useCallback(async (text: string) => {
    const response = await fetch(`${httpBase}/api/chat/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!response.ok) { setError(((await response.json()) as { error?: string }).error ?? "Failed to submit answer."); return; }
    setChat(await response.json() as ChatState);
  }, [httpBase]);

  return { connected, chat, tasks, diagnostics, sendObjective, sendAnswer, error };
}
