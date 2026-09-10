import type { LocalHttpRequest, LocalHttpResponse, LocalHttpTransport } from "./types.js";

export class FetchLocalHttpTransport implements LocalHttpTransport {
  async request(request: LocalHttpRequest): Promise<LocalHttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      signal: request.signal,
      ...(request.method === "POST" ? { headers: { "content-type": "application/json" } } : {}),
      ...(request.body === undefined ? {} : { body: request.body })
    });
    return { status: response.status, body: await response.text() };
  }
}
