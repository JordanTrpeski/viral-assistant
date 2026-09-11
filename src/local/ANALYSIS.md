# `src/local/` Subsystem Analysis — Connector Access

Scope: `types.ts`, `ollama.ts`, `registry.ts`, `tasks.ts`, `config.ts` (plus `http.ts`, `policy.ts`).
Question under study: can the local reasoning layer (`LOCAL_MODEL`) read from and write to
external connectors (calendar, email, gym, notes, finance)?

**Short answer: No.** The local subsystem is a *stateless, text-in/text-out* reasoner over a
loopback-only Ollama endpoint. It has no connector abstraction, no filesystem access, no external
API access, and no action/tool-execution channel. It can only reason over text a caller hands it.

---

## Direct answers

### 1. Does `LocalBrain` accept connector access as a parameter or dependency?

**No.** `LocalBrain` takes exactly one dependency — a `LocalModel` — and nothing else:

```ts
// src/local/tasks.ts
export class LocalBrain {
  constructor(private readonly model: LocalModel) {}
  // …
}
```

Every method accepts only `input: string`, an optional caller-supplied
`context?: Record<string, unknown>`, and `LocalTaskOptions` (`timeoutMs`, `signal`, `model`).
There is no connector parameter, registry, or interface anywhere in the constructor or method
signatures.

### 2. What methods exist on `LocalBrain`?

Four public methods (all in `src/local/tasks.ts`):

| Method | Signature | Purpose |
|---|---|---|
| `classify` | `(input, options)` → `LocalTaskResult<Classification>` | Route request to `LOCAL_OK` / `CODING_HARNESS_REQUIRED` / `OWNER_INPUT_REQUIRED` / `UNSURE`. Deterministic policy first, model only as fallback. |
| `summarize` | `(input, context, options)` → `LocalTaskResult<Summary>` | Concise plain-text summary (capped at 4 000 chars). |
| `selectRelevantContext` | `(task, sections, options)` → `LocalTaskResult<RelevantContext>` | Pick relevant section keys + build a bounded context packet. |
| `recommendRoute` | `(input, context, options)` → `LocalTaskResult<RoutingRecommendation>` | Non-authoritative routing suggestion; policy still overrides via `enforceEscalation`. |

The underlying `LocalModel` interface (`types.ts`) exposes only:

```ts
export interface LocalModel {
  readonly id: LocalModelProviderId;
  readonly displayName: string;
  probe(): Promise<LocalModelProbe>;                          // health/availability
  infer(request: LocalInferenceRequest): Promise<LocalInferenceResult>;  // single text generation
}
```

`infer` is the only generation primitive — single-shot, stateless, **no tool-calling loop**.

### 3. What data can the local model ACCESS today?

**Text only**, and only text the caller explicitly injects. The model receives a single prompt
string built from `input` plus an optional `context` object serialized inline:

```ts
// src/local/ollama.ts — infer()
const prompt = request.context === undefined
  ? request.input
  : `${request.input}\n\nStructured context:\n${JSON.stringify(request.context)}`;
body = JSON.stringify({ model, prompt, stream: false });
// POST {baseUrl}/api/generate   (baseUrl forced to loopback)
```

- **No filesystem access.** The subsystem never reads files for the model. (`registry.ts` only
  uses `fs.existsSync` to locate the `ollama.exe` binary — not to feed the model.)
- **No external API access.** The only network call is to Ollama itself, and the endpoint is
  hard-constrained to loopback:

  ```ts
  // src/local/config.ts — assertLoopbackUrl()
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !loopbackHosts.has(url.hostname))
    throw new Error("localBrain.baseUrl must use an HTTP(S) loopback address");
  ```

- **No connector access.** A repo-wide search for `connector|calendar|gym|finance` returns
  **zero** matches in `src/`. The concept does not exist.

So the model's entire world is the prompt string. If a caller *already fetched* connector data
elsewhere and passed it in `context`, the model would see it as text — but nothing in the codebase
does that, and there is no interface for it.

### 4. Can `LOCAL_MODEL` read from connectors (calendar, email, gym, notes, finance)?

**No.** There is no connector abstraction to read from. The model cannot initiate any read; it can
only reason over text the caller provides.

### 5. Can `LOCAL_MODEL` write to connectors?

**No.** `infer()` returns only `LocalInferenceResult.output` (a string). There is no tool-use,
action-dispatch, or side-effect channel. The model cannot invoke anything; `LocalBrain` methods
merely parse the model's text into structured values and hand them back to the caller. All writes
in Viral happen elsewhere (e.g. the deterministic finalizer's git commits), never through the
local model.

### 6. What would need to change for bidirectional connector access?

See **Wiring needed** below.

---

## Current capabilities (what it CAN do)

- Run a **local, private, loopback-only** LLM (Ollama) with strict timeout/cancellation handling.
- **Classify / route** requests, with a deterministic policy layer (`policy.ts`) that is always
  authoritative over the model (`enforceEscalation`).
- **Summarize** arbitrary caller-supplied text.
- **Select relevant context** from caller-supplied named sections and emit a size-bounded packet.
- Reason over a caller-supplied `context` object (serialized into the prompt).
- Report health via `probe()` (CLI installed? service running? models present? preferred model?).

All of this is **pure reasoning over injected text** — no I/O of its own beyond talking to Ollama.

## Missing pieces (what's BLOCKED)

| Capability | Status | Why |
|---|---|---|
| Read a connector (calendar/email/notes/finance/gym) | ❌ | No connector interface exists; `LocalBrain` has no such dependency. |
| Write/act on a connector | ❌ | `infer()` yields text only; no tool-call loop or action executor. |
| Filesystem read for the model | ❌ | Never wired; loopback transport is Ollama-only. |
| Arbitrary outbound HTTP | ❌ (by design) | `assertLoopbackUrl` blocks non-loopback hosts. |
| Multi-step agent / tool loop | ❌ | `infer` is single-shot and stateless. |
| Owner gating of consequential writes | ⚠️ partial | Policy can emit `OWNER_INPUT_REQUIRED`, but nothing consumes it for connector actions (no actions exist). |

## Wiring needed (where connectors would plug in)

The clean seam is a **new `ConnectorRegistry` dependency injected into `LocalBrain`** (mirroring how
`LocalModel` is injected today), plus an **action-executor loop** around `infer()` for writes.

1. **Define connector contracts** (new `src/local/connectors/types.ts`):
   read returns data; write is an explicit, validated action — separate from the loopback
   `LocalHttpTransport`, since connectors are *not* loopback-constrained.
2. **Read path:** an orchestration step calls `connectors.read(...)`, then passes the result into
   the existing `context` argument. Minimal change — the model already accepts `context`.
3. **Write path:** switch `infer` usage to a **tool/function-calling loop**: the model proposes a
   structured action → a deterministic executor validates it → routes consequential writes through
   the existing `OWNER_INPUT_REQUIRED` gate → performs the write → feeds the result back.
4. **Injection point:** `LocalBrain` constructor gains a second dependency; `createLocalModel` /
   a new `createLocalBrain` in `registry.ts` wires the concrete registry.
5. **Security posture:** reads should be scoped/read-only per connector; every write must be
   owner-gated and logged. The loopback guarantee for Ollama stays intact — connectors get their
   own transport with their own auth and allow-list.

## Code snippets: current usage vs. connector access

### Current — text only, caller pre-gathers everything

```ts
// How LocalBrain is built today (src/efficiency/registry.ts)
const localModel = await createLocalModel(root);
const localBrain = new LocalBrain(localModel);          // ONE dependency: the model

// How it is called today (src/objective.ts) — caller hands in a plain object
const local = await localBrain.summarize(objective, {
  project: state.project,
  milestone: state.currentMilestone,
  blockers: state.blockers,
  nextAction: state.nextAction,
}, { timeoutMs });
// The model sees only: prompt + JSON.stringify(context). No live data, no actions.
```

### Proposed — connector-aware `LocalBrain` (illustrative, not implemented)

```ts
// NEW: connector contracts
export interface ConnectorRead  { connector: string; query: Record<string, unknown>; }
export interface ConnectorWrite { connector: string; action: string; payload: Record<string, unknown>; }

export interface ConnectorRegistry {
  read(request: ConnectorRead): Promise<{ data: unknown }>;                 // e.g. calendar events
  write(request: ConnectorWrite): Promise<{ ok: boolean; detail: string }>; // owner-gated
}

// NEW: second injected dependency (mirrors the model injection)
export class LocalBrain {
  constructor(
    private readonly model: LocalModel,
    private readonly connectors?: ConnectorRegistry,   // optional → backward compatible
  ) {}

  // READ: fetch live data, then reason over it via the EXISTING context channel
  async planWithConnectors(task: string, reads: ConnectorRead[], options: LocalTaskOptions = {}) {
    const gathered = this.connectors
      ? await Promise.all(reads.map((r) => this.connectors!.read(r)))
      : [];
    return this.summarize(task, { connectorData: gathered }, options);
  }

  // WRITE: model proposes a structured action; a deterministic executor validates + gates it
  async proposeAction(input: string, options: LocalTaskOptions = {}) {
    const inference = await this.model.infer(requestOptions(
      `Propose ONE connector action. Return only JSON {connector, action, payload}. Request: ${input}`,
      options,
    ));
    const action = structured(inference.output) as ConnectorWrite | null;
    if (!action || !this.connectors) return failed(inference, "No action or no connector registry.");
    // Consequential writes must pass the owner gate before execution:
    if (deterministicEscalation(input) === "OWNER_INPUT_REQUIRED") {
      return { succeeded: false, escalation: "OWNER_INPUT_REQUIRED", value: action, inference, diagnostics: ["Owner approval required."] };
    }
    const result = await this.connectors.write(action);      // the missing side-effect channel
    return { succeeded: result.ok, escalation: "LOCAL_OK", value: { action, result }, inference, diagnostics: [] };
  }
}
```

### Wiring change (illustrative)

```ts
// src/local/registry.ts — today
export async function createLocalModel(root: string): Promise<LocalModel> { /* Ollama only */ }

// …would gain a sibling that also injects connectors:
export async function createLocalBrain(root: string): Promise<LocalBrain> {
  const model = await createLocalModel(root);
  const connectors = await createConnectorRegistry(root);   // NEW: calendar/email/notes/finance/gym
  return new LocalBrain(model, connectors);
}
```

---

## Bottom line

Today `LOCAL_MODEL` is a **sandboxed reasoner**: private, loopback-only, text-in/text-out, with a
deterministic policy guard. It can neither read nor write connectors. Adding bidirectional
connector access is an **additive** change — a `ConnectorRegistry` injected into `LocalBrain`, a
read path that reuses the existing `context` argument, and a write path built as an owner-gated
tool-call loop around `infer()`. None of that exists yet; the current seams (`context` injection,
dependency-injected `LocalModel`, and the `OWNER_INPUT_REQUIRED` policy signal) are where it would
attach.
