import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import { NotFoundError, ValidationError } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RouteRequest {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export type RouteHandler = (request: RouteRequest) => Promise<unknown> | unknown;

interface Route {
  method: HttpMethod;
  pattern: RegExp;
  names: string[];
  handler: RouteHandler;
  status: number;
}

/** A minimal JSON router: `/api/things/:id` patterns, one handler per method and path. */
export class Router {
  private readonly routes: Route[] = [];

  add(method: HttpMethod, path: string, handler: RouteHandler, status = method === "POST" ? 201 : method === "DELETE" ? 204 : 200): this {
    const names: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:([a-zA-Z]+)/g, (_match, name: string) => { names.push(name); return "([^/]+)"; })}$`);
    this.routes.push({ method, pattern, names, handler, status });
    return this;
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | { allowed: HttpMethod[] } | null {
    const allowed: HttpMethod[] = [];
    for (const route of this.routes) {
      const found = route.pattern.exec(path);
      if (!found) continue;
      if (route.method !== method) { allowed.push(route.method); continue; }
      const params: Record<string, string> = {};
      route.names.forEach((name, index) => { params[name] = decodeURIComponent(found[index + 1] ?? ""); });
      return { route, params };
    }
    return allowed.length ? { allowed } : null;
  }
}

export interface StaticFile {
  path: string;
  contentType: string;
}

/** Maps a request path to a file on disk, or null. Must only return files the dashboard intends to serve. */
export type StaticResolver = (path: string) => StaticFile | null;

const maxBodyBytes = 1_000_000;
const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const allowedHostnames = new Set(["127.0.0.1", "localhost", "[::1]"]);

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (status === 204) {
    response.writeHead(204).end();
    return;
  }
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(body);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBodyBytes) throw new ValidationError("Request body is too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try { return JSON.parse(text) as unknown; }
  catch { throw new ValidationError("Request body must be valid JSON"); }
}

/** Rejects requests that did not come from this machine, or that name a non-local Host (DNS-rebinding defence). */
function localOnly(request: IncomingMessage): string | null {
  if (!loopbackAddresses.has(request.socket.remoteAddress ?? "")) return "Only loopback clients may use the dashboard";
  const host = request.headers.host ?? "";
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0] ?? "";
  if (!allowedHostnames.has(hostname)) return "Host header must name a loopback address";
  return null;
}

export async function handleRequest(router: Router, statics: StaticResolver, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const refused = localOnly(request);
  if (refused) {
    sendJson(response, 403, { error: refused });
    return;
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";
  if (!url.pathname.startsWith("/api/")) {
    const file = method === "GET" ? statics(url.pathname) : null;
    if (!file) {
      sendJson(response, 404, { error: `Not found: ${url.pathname}` });
      return;
    }
    try {
      const content = await readFile(file.path);
      response.writeHead(200, { "content-type": file.contentType, "cache-control": "no-store" }).end(content);
    } catch {
      sendJson(response, 404, { error: `Not found: ${url.pathname} (run pnpm run build first)` });
    }
    return;
  }
  const matched = router.match(method, url.pathname);
  if (!matched) {
    sendJson(response, 404, { error: `Unknown route: ${method} ${url.pathname}` });
    return;
  }
  if ("allowed" in matched) {
    response.setHeader("allow", matched.allowed.join(", "));
    sendJson(response, 405, { error: `${method} is not allowed on ${url.pathname}` });
    return;
  }
  try {
    let body: unknown = {};
    if (method !== "GET" && method !== "DELETE") {
      // Requiring JSON blocks cross-site HTML form posts, which cannot set this content type without a CORS preflight.
      if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        sendJson(response, 415, { error: "Request body must be sent as application/json" });
        return;
      }
      body = await readBody(request);
    }
    const result = await matched.route.handler({ params: matched.params, query: url.searchParams, body });
    sendJson(response, matched.route.status, result ?? {});
  } catch (error) {
    if (error instanceof ValidationError) sendJson(response, 400, { error: error.message });
    else if (error instanceof NotFoundError) sendJson(response, 404, { error: error.message });
    else sendJson(response, 500, { error: `Internal error: ${(error as Error).message}` });
  }
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

/**
 * Serves the page and stylesheet from `uiSourceDir`, and compiled browser modules from `distDir/ui` and
 * `distDir/shared` under `/assets/`. File names are restricted to a safe pattern, so no path can escape.
 */
export function dashboardStatics(uiSourceDir: string, distDir: string): StaticResolver {
  return (path) => {
    if (path === "/" || path === "/index.html") return { path: join(uiSourceDir, "index.html"), contentType: contentTypes[".html"]! };
    if (path === "/styles.css") return { path: join(uiSourceDir, "styles.css"), contentType: contentTypes[".css"]! };
    const asset = /^\/assets\/(ui|shared)\/([a-z0-9-]+\.js)$/.exec(path);
    if (asset) return { path: join(distDir, asset[1]!, asset[2]!), contentType: contentTypes[extname(asset[2]!)]! };
    return null;
  };
}

export interface RunningServer {
  host: string;
  port: number;
  stop(): Promise<void>;
}

export async function listen(router: Router, statics: StaticResolver, host: string, port: number): Promise<RunningServer> {
  const server: Server = createServer((request, response) => { void handleRequest(router, statics, request, response); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
  const address = server.address() as AddressInfo;
  return {
    host,
    port: address.port,
    stop: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}
