import assert from "node:assert/strict";
import test from "node:test";
import type { ProcessResult, ProcessRunner, ProcessSpec } from "../src/harness/types.js";
import { assertLoopbackUrl, validateLocalModelConfig } from "../src/local/config.js";
import { OllamaLocalModel } from "../src/local/ollama.js";
import type { LocalHttpRequest, LocalHttpResponse, LocalHttpTransport, LocalModelConfig } from "../src/local/types.js";

const config: LocalModelConfig = { provider: "ollama", baseUrl: "http://127.0.0.1:11434", preferredModel: "small:latest", defaultTimeoutMs: 5_000 };

function processResult(changes: Partial<ProcessResult> = {}): ProcessResult {
  return {
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.001Z", durationMs: 1,
    exitCode: 0, signal: null, timedOut: false, stdout: "ollama version 1.0", stderr: "", error: null, ...changes
  };
}

class FakeRunner implements ProcessRunner {
  readonly calls: ProcessSpec[] = [];
  constructor(private readonly result = processResult()) {}
  async run(spec: ProcessSpec): Promise<ProcessResult> { this.calls.push(spec); return this.result; }
}

class FakeHttp implements LocalHttpTransport {
  readonly calls: LocalHttpRequest[] = [];
  constructor(private readonly responses: LocalHttpResponse[]) {}
  async request(request: LocalHttpRequest): Promise<LocalHttpResponse> {
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("Ollama connection refused");
    return response;
  }
}

test("local model configuration accepts only loopback and supports a configurable preferred model", () => {
  assert.equal(assertLoopbackUrl("http://localhost:11434/"), "http://localhost:11434");
  assert.throws(() => assertLoopbackUrl("https://example.com/ollama"), /loopback/);
  assert.throws(() => new OllamaLocalModel({ ...config, baseUrl: "https://example.com" }, { processRunner: new FakeRunner(), http: new FakeHttp([]), executable: "ollama" }), /loopback/);
  assert.deepEqual(validateLocalModelConfig({ provider: "ollama", baseUrl: "http://127.0.0.1:11434", preferredModel: null, defaultTimeoutMs: 10_000 }), {
    provider: "ollama", baseUrl: "http://127.0.0.1:11434", preferredModel: null, defaultTimeoutMs: 10_000
  });
});

test("Ollama probe distinguishes CLI, service, models, and preferred-model usability", async () => {
  const http = new FakeHttp([{ status: 200, body: JSON.stringify({ models: [{ name: "other:latest" }, { name: "small:latest" }] }) }]);
  const model = new OllamaLocalModel(config, { processRunner: new FakeRunner(), http, executable: "ollama-test" });
  const probe = await model.probe();
  assert.equal(probe.installed, true);
  assert.equal(probe.running, true);
  assert.equal(probe.usable, true);
  assert.deepEqual(probe.models, ["other:latest", "small:latest"]);
  assert.equal(probe.preferredModel, "small:latest");
});

test("Ollama inference uses an explicit model, structured context, and returns structured success", async () => {
  const http = new FakeHttp([{ status: 200, body: JSON.stringify({ model: "override:latest", response: "local answer" }) }]);
  const model = new OllamaLocalModel(config, { processRunner: new FakeRunner(), http, executable: "ollama-test" });
  const result = await model.infer({ input: "Summarize", context: { state: "ready" }, model: "override:latest", timeoutMs: 5_000 });
  assert.equal(result.succeeded, true);
  assert.equal(result.model, "override:latest");
  assert.equal(result.output, "local answer");
  const body = JSON.parse(http.calls[0]!.body!) as { model: string; prompt: string; stream: boolean };
  assert.equal(body.model, "override:latest");
  assert.match(body.prompt, /"state":"ready"/);
  assert.equal(body.stream, false);
  assert.match(http.calls[0]!.url, /^http:\/\/127\.0\.0\.1/);
});

test("Ollama handles no model, unavailable service, HTTP errors, and malformed output cleanly", async () => {
  const noModel = new OllamaLocalModel({ ...config, preferredModel: null }, { processRunner: new FakeRunner(), http: new FakeHttp([]), executable: "ollama" });
  assert.match((await noModel.infer({ input: "hello" })).error ?? "", /No local model selected/);

  for (const [http, pattern] of [
    [new FakeHttp([]), /unavailable/],
    [new FakeHttp([{ status: 500, body: "failed" }]), /HTTP 500/],
    [new FakeHttp([{ status: 200, body: "{}" }]), /malformed/]
  ] as const) {
    const result = await new OllamaLocalModel(config, { processRunner: new FakeRunner(), http, executable: "ollama" }).infer({ input: "hello" });
    assert.equal(result.succeeded, false);
    assert.match(result.error ?? "", pattern);
  }
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const invalidContext = await new OllamaLocalModel(config, { processRunner: new FakeRunner(), http: new FakeHttp([]), executable: "ollama" }).infer({ input: "hello", context: circular });
  assert.match(invalidContext.error ?? "", /not JSON-serializable/);
});

test("Ollama reports cancellation and timeout without throwing", async () => {
  const waiting: LocalHttpTransport = {
    request: async ({ signal }) => await new Promise<LocalHttpResponse>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  };
  const model = new OllamaLocalModel(config, { processRunner: new FakeRunner(), http: waiting, executable: "ollama" });
  const controller = new AbortController();
  controller.abort();
  const cancelled = await model.infer({ input: "hello", signal: controller.signal });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.timedOut, false);

  const timedOut = await model.infer({ input: "hello", timeoutMs: 1_000 });
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.cancelled, false);
});
