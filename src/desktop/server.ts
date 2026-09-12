import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { ObjectiveOptions } from "../objective.js";
import type { DesktopChatSession } from "./chat.js";
import type { DesktopServerEvent, DesktopTaskSummary, DiagnosticsSnapshot } from "./types.js";

export interface DesktopServerDependencies {
  chat: DesktopChatSession;
  tasks(): Promise<DesktopTaskSummary[]>;
  diagnostics(): Promise<DiagnosticsSnapshot>;
}

export interface DesktopServerOptions {
  /** Loopback only — this daemon never binds a non-local interface (PRINCIPLES.md local-first). */
  host?: "127.0.0.1" | "localhost";
  port?: number;
  broadcastIntervalMs?: number;
}

export interface DesktopServerAddress { host: string; port: number; }

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text) as unknown;
}

function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function objectiveOptions(body: unknown): ObjectiveOptions {
  const milestone = stringField(body, "milestone");
  const planOnly = typeof body === "object" && body !== null && (body as Record<string, unknown>).planOnly === true;
  return { ...(milestone ? { milestone } : {}), ...(planOnly ? { planOnly } : {}) };
}

/**
 * Local HTTP daemon + WebSocket channel that front-ends the governed objective workflow for the
 * Electron/React desktop UI (milestones/M06_VIRAL_DESKTOP.md section E). It binds loopback-only, exposes
 * a small REST surface for the chat/objective flow, the task queue, and the diagnostic panel, and
 * broadcasts the same three shapes over WebSocket so every connected UI stays live. All state comes from
 * injected dependencies, so it is fully testable without opening a real socket (see tests/desktop-*.ts).
 */
export class DesktopServer {
  private readonly http: Server;
  private wss: WebSocketServer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly clients = new Set<WebSocket>();

  constructor(private readonly deps: DesktopServerDependencies, private readonly options: DesktopServerOptions = {}) {
    this.http = createServer((req, res) => { void this.route(req, res); });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { status: "ok" });
      if (req.method === "GET" && url.pathname === "/api/chat") return send(res, 200, this.deps.chat.snapshot());
      if (req.method === "POST" && url.pathname === "/api/chat/start") {
        const body = await readJsonBody(req);
        const objective = stringField(body, "objective");
        if (!objective) return send(res, 400, { error: "objective is required" });
        const chat = await this.deps.chat.start(objective, objectiveOptions(body));
        await this.broadcast();
        return send(res, 200, chat);
      }
      if (req.method === "POST" && url.pathname === "/api/chat/answer") {
        const body = await readJsonBody(req);
        const text = stringField(body, "text");
        if (!text) return send(res, 400, { error: "text is required" });
        const chat = await this.deps.chat.answer(text, objectiveOptions(body));
        await this.broadcast();
        return send(res, 200, chat);
      }
      if (req.method === "GET" && url.pathname === "/api/tasks") return send(res, 200, await this.deps.tasks());
      if (req.method === "GET" && url.pathname === "/api/diagnostics") return send(res, 200, await this.deps.diagnostics());
      send(res, 404, { error: "not found" });
    } catch (error) {
      send(res, 400, { error: (error as Error).message });
    }
  }

  private async eventsSnapshot(): Promise<DesktopServerEvent[]> {
    const [tasks, diagnostics] = await Promise.all([this.deps.tasks(), this.deps.diagnostics()]);
    return [{ type: "chat", chat: this.deps.chat.snapshot() }, { type: "tasks", tasks }, { type: "diagnostics", diagnostics }];
  }

  private async broadcast(): Promise<void> {
    if (this.clients.size === 0) return;
    const events = await this.eventsSnapshot();
    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      for (const event of events) client.send(JSON.stringify(event));
    }
  }

  async start(): Promise<DesktopServerAddress> {
    const host = this.options.host ?? "127.0.0.1";
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Desktop server binds only to loopback addresses");
    await new Promise<void>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(this.options.port ?? 0, host, () => resolve());
    });
    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });
    this.wss.on("connection", (socket) => {
      this.clients.add(socket);
      socket.once("close", () => this.clients.delete(socket));
      void this.eventsSnapshot().then((events) => { for (const event of events) socket.send(JSON.stringify(event)); });
    });
    this.timer = setInterval(() => { void this.broadcast(); }, this.options.broadcastIntervalMs ?? 1_000);
    this.timer.unref();
    const address = this.http.address() as AddressInfo | null;
    if (!address) throw new Error("Desktop server failed to bind a network address");
    return { host, port: address.port };
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const client of this.clients) client.close();
    this.clients.clear();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
    await new Promise<void>((resolve, reject) => this.http.close((error) => (error ? reject(error) : resolve())));
  }
}
