import assert from "node:assert/strict";
import test from "node:test";
import { DesktopChatSession, type ObjectiveSubmitter } from "../src/desktop/chat.js";
import { DesktopServer } from "../src/desktop/server.js";
import type { DesktopServerEvent, DesktopTaskSummary, DiagnosticsSnapshot } from "../src/desktop/types.js";
import type { ObjectiveSubmission } from "../src/objective.js";
import type { SelectionDecision } from "../src/efficiency/types.js";

function decision(action: SelectionDecision["action"], changes: Partial<SelectionDecision> = {}): SelectionDecision {
  return { schemaVersion: 1, taskId: "OBJ-X", action, tier: "CODING_HARNESS", effort: "MEDIUM", harness: "claude", model: null, reason: "r", ownerInputRequired: action === "OWNER_INPUT_REQUIRED", freshSessionRecommended: false, nextProbeAt: null, failureCount: 0, maximumAttempts: 6, ...changes };
}

function submission(objective: string, decisionValue: SelectionDecision): ObjectiveSubmission {
  return { taskId: decisionValue.taskId, taskPath: `tasks/${decisionValue.taskId}.json`, planOnly: false, decision: decisionValue, execution: null, task: { schemaVersion: 1, id: decisionValue.taskId, milestone: "M06_VIRAL_DESKTOP", objective, status: "pending", acceptanceCriteria: [], dependencies: [], relevantFiles: [], notes: [], nextAction: "n", verificationResult: null } };
}

function fakeSubmitter(): ObjectiveSubmitter {
  return { submit: async (objective: string) => submission(objective, decision("OWNER_INPUT_REQUIRED", { clarifyingQuestions: ["Which STT engine should it use?"] })) };
}

const emptyTasks: DesktopTaskSummary[] = [];
const emptyDiagnostics: DiagnosticsSnapshot = { generatedAt: "2026-09-12T00:00:00.000Z", taskProgress: [], tokenUsage: { contextCharacters: null, contextBudgetCharacters: null, latestReason: null }, systemHealth: { healthy: true, checks: [] }, recentLogs: [], errors: [] };

async function startServer(): Promise<{ server: DesktopServer; base: string; ws: string }> {
  const server = new DesktopServer({ chat: new DesktopChatSession(fakeSubmitter()), tasks: async () => emptyTasks, diagnostics: async () => emptyDiagnostics }, { broadcastIntervalMs: 20 });
  const address = await server.start();
  return { server, base: `http://${address.host}:${address.port}`, ws: `ws://${address.host}:${address.port}/ws` };
}

test("desktop server refuses to bind a non-loopback host", async () => {
  const server = new DesktopServer({ chat: new DesktopChatSession(fakeSubmitter()), tasks: async () => emptyTasks, diagnostics: async () => emptyDiagnostics }, { host: "0.0.0.0" as unknown as "127.0.0.1" });
  await assert.rejects(() => server.start(), /loopback/);
});

test("REST endpoints serve health, chat, tasks, and diagnostics over loopback", async () => {
  const { server, base } = await startServer();
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const start = await fetch(`${base}/api/chat/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objective: "build voice interface" }) });
    assert.equal(start.status, 200);
    const chat = await start.json() as { pendingQuestions: string[] };
    assert.deepEqual(chat.pendingQuestions, ["Which STT engine should it use?"]);

    const tasks = await fetch(`${base}/api/tasks`);
    assert.deepEqual(await tasks.json(), emptyTasks);

    const diagnostics = await fetch(`${base}/api/diagnostics`);
    assert.deepEqual(await diagnostics.json(), emptyDiagnostics);

    const missing = await fetch(`${base}/api/unknown`);
    assert.equal(missing.status, 404);

    const badStart = await fetch(`${base}/api/chat/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    assert.equal(badStart.status, 400);
  } finally {
    await server.stop();
  }
});

test("WebSocket clients receive an initial snapshot and updates after chat activity", async () => {
  const { server, base, ws: wsUrl } = await startServer();
  try {
    const socket = new WebSocket(wsUrl);
    const received: DesktopServerEvent[] = [];
    const nextEventOfType = (type: DesktopServerEvent["type"]): Promise<DesktopServerEvent> => new Promise((resolve) => {
      const existing = received.find((event) => event.type === type);
      if (existing) return resolve(existing);
      socket.addEventListener("message", function handler(message: MessageEvent) {
        const event = JSON.parse(message.data as string) as DesktopServerEvent;
        received.push(event);
        if (event.type === type) { socket.removeEventListener("message", handler); resolve(event); }
      });
    });
    await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve()); socket.addEventListener("error", reject); });

    const initialChat = await nextEventOfType("chat");
    assert.equal(initialChat.type, "chat");

    await fetch(`${base}/api/chat/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objective: "build voice interface" }) });
    const updated = await new Promise<DesktopServerEvent>((resolve) => {
      socket.addEventListener("message", function handler(message: MessageEvent) {
        const event = JSON.parse(message.data as string) as DesktopServerEvent;
        if (event.type === "chat" && event.chat.pendingQuestions.length > 0) { socket.removeEventListener("message", handler); resolve(event); }
      });
    });
    assert.equal(updated.type, "chat");
    assert.deepEqual(updated.type === "chat" ? updated.chat.pendingQuestions : [], ["Which STT engine should it use?"]);
    socket.close();
  } finally {
    await server.stop();
  }
});
