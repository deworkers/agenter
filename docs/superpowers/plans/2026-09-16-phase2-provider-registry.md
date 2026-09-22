# Phase 2: Provider Abstraction & Multi-Provider Registry Implementation Plan

> **Status: DONE (2026-09-16).** The five backend tasks were implemented and committed (`a3a8f28`, `ecdab3d`, `3deaa1f`, `762bb8a`, `817f9d2`). The provider-selector UI was added separately as an early UI increment (`4dc166c`); it is not evidence that the complete Phase 8 UI is implemented. Final verification must be rerun on Node.js >=24.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the app run with multiple configured OpenAI-compatible providers (e.g. a fast local model and a coding-focused local model) and switch between them per request, via a `ProviderRegistry` that `AgentRuntime` selects from.

**Architecture:** `ProviderRegistry` (new, in `packages/agent-core`) holds `LlmProvider` instances keyed by id and knows which one is the configured default; it only ever sees the `LlmProvider` interface, never a concrete provider class. `AgentRuntime.runTurn` gains an optional `providerId` parameter — when given, it looks up that provider in the registry; when omitted, it uses the registry's default. `apps/api` (the composition root) is the only place that imports a concrete provider class (`OpenAICompatibleProvider`) and registers instances into the registry, via a new `providerFactory.ts`. Configuration moves from `PROVIDER_*` env vars to `config/providers.yaml`, listing multiple named OpenAI-compatible endpoints, parsed and env-interpolated by a rewritten `apps/api/src/config.ts`. Anthropic is a future provider extension and is not part of the current scope. No `ProviderRouter`, no `TaskType`, and no `routing.yaml` are implemented here; the provider-selector UI was added separately as an early increment, while the complete Phase 8 UI remains future work.

**Tech Stack:** Same as Phase 1 (Node.js with `node:sqlite`, TypeScript strict, Express, Vitest, npm workspaces), plus one new exact-pinned dependency: `yaml` (in `apps/api`).

**Spec:** `PROMT.md` §4 (provider abstraction — `OpenAICompatibleProvider` only for this phase), §5 (`ProviderRegistry`, YAML config, env var interpolation, no secrets in git). §6 (`ProviderRouter`) and §14 (frontend model selector) are explicitly deferred to later phases.

## Global Constraints

- Node.js >=24.0.0, using built-in `node:sqlite` — unchanged from Phase 1.
- TypeScript strict mode (`tsconfig.base.json`) — every new/modified package extends it unchanged.
- All new dependencies pinned to an exact version (no `^`/`~` ranges) via `npm install <pkg> --save-exact`, matching every existing dependency in this repo.
- No real API keys committed to git. Any provider entry needing a real secret references it as `${VAR_NAME}` in `config/providers.yaml`, resolved from `.env` at load time; only non-secret placeholder values (e.g. `apiKey: local` for a local server) may be literal in `config/providers.yaml`.
- `AgentRuntime` and all of `packages/agent-core` stay provider-agnostic — they depend only on the `LlmProvider` interface, never on `OpenAICompatibleProvider` directly (PROMT.md §4).
- Vitest for all tests, mirroring each package's existing `test` script (`vitest run`).
- Every package's `tsconfig.json` extends `tsconfig.base.json` and every `package.json` follows the existing shape (`private: true`, `type: module`, `main`/`types` → `./src/index.ts`, `typecheck`/`test` scripts).

## Decisions worth flagging

- **`AnthropicProvider` is explicitly excluded from this phase** — the user wants OpenAI-compatible providers only for now, with the ability to switch between multiple of them (e.g. a fast local model and a coding-focused local model, matching PROMT.md §5's own example of `local-fast`/`local-code`). `ProviderConfigEntry` still carries a `type` field (currently only `"openai-compatible"` is a valid value) so a future `anthropic` type is additive, not a breaking reshape.
- **`ProviderRegistry` lives in `packages/agent-core`**, alongside `AgentRuntime`/`ContextBuilder`, since PROMT.md §3 groups it with the other core orchestration components. It is constructed and populated with `LlmProvider` instances only — `apps/api`'s new `providerFactory.ts` is the only file that imports the concrete provider class.
- **`AgentRuntime.runTurn` gains an optional `providerId` parameter now**, even though `ProviderRouter` (manual/auto mode) is Phase 3. Without this, Phase 3 would have to change `AgentRuntime`'s signature again. Phase 2 adds no `TaskType`/auto-routing logic — a caller either names a provider or gets the configured default. This is exactly the "switch between them" capability the user asked for: any caller (the SSE route today, a future UI selector later) can pass `providerId` to pick a specific configured provider per request.
- **Config moves from flat `PROVIDER_*` env vars to `config/providers.yaml`**, matching PROMT.md §5's example exactly (a `providers:` map keyed by id, each with `type`/`baseUrl`/`apiKey`/`model`), plus one key the spec's snippet doesn't show: a top-level `defaultProvider`. This is needed because Phase 2 has no router to decide which provider handles a request when the caller doesn't name one.
- **An unknown `providerId` yields a `run.error` event without ever calling `storage.addRun`** — a "run" row represents an attempted provider call, and none happened here. The triggering user message is still persisted, consistent with the existing pattern where a mid-stream provider error also leaves the user message persisted.
- **`GET /api/providers`'s response shape changes** from a bare array to `{ providers: [...], defaultProviderId }`. The backend contract is intentionally ready for the UI; a provider selector was later added as a separate early increment, while the complete model/skill/tool UI remains Phase 8 work.
- **The backend plan does not include general `apps/web` work.** A provider-selector UI was later added as a separate early increment; skill/tool UI and complete Phase 8 work remain in `2026-09-21-phase8-ui.md`.

---

## File Structure

```text
agenter/
├── config/
│   └── providers.yaml                     NEW — multi-provider config, env-var interpolated
├── .env.example                            MODIFIED — drop PROVIDER_*, document per-provider secrets
│
├── packages/
│   └── agent-core/
│       └── src/
│           ├── ProviderRegistry.ts         NEW
│           ├── ProviderRegistry.test.ts    NEW
│           ├── AgentRuntime.ts             MODIFIED — takes ProviderRegistry, optional providerId
│           ├── AgentRuntime.test.ts        MODIFIED
│           └── index.ts                    MODIFIED — export ProviderRegistry
│
└── apps/
    └── api/
        └── src/
            ├── config.ts                   MODIFIED — YAML + env interpolation, multiple providers
            ├── config.test.ts              NEW
            ├── providerFactory.ts          NEW
            ├── providerFactory.test.ts     NEW
            ├── services/ChatService.ts     MODIFIED — sendMessage(chatId, content, providerId?)
            ├── services/ChatService.test.ts MODIFIED
            ├── routes/providers.ts         MODIFIED — registry-backed, new response shape
            ├── routes/messages.ts          MODIFIED — reads optional providerId from body
            └── index.ts                    MODIFIED — builds ProviderRegistry via providerFactory
```

---

## Task 1: agent-core — ProviderRegistry

**Files:**
- Create: `packages/agent-core/src/ProviderRegistry.ts`
- Test: `packages/agent-core/src/ProviderRegistry.test.ts`
- Modify: `packages/agent-core/src/index.ts`

**Interfaces:**
- Consumes: `LlmProvider` (from `./types.js`, existing).
- Produces: `class ProviderRegistry` with constructor `(defaultProviderId: string)`, methods `register(provider: LlmProvider): void`, `get(id: string): LlmProvider | undefined`, `list(): LlmProvider[]`, `getDefaultId(): string`, `getDefault(): LlmProvider` (throws if the default id was never registered). Task 2 (`AgentRuntime`) and Task 5 (`apps/api` routes/bootstrap) both consume this.

- [x] **Step 1: Write the failing test**

```ts
// packages/agent-core/src/ProviderRegistry.test.ts
import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./ProviderRegistry.js";
import type { LlmEvent, LlmProvider, LlmRequest } from "./types.js";

function fakeProvider(id: string, model: string): LlmProvider {
  return {
    id,
    model,
    supportsTools: () => false,
    supportsVision: () => false,
    getContextWindow: () => 8192,
    async *chat(_request: LlmRequest): AsyncIterable<LlmEvent> {},
  };
}

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider by id", () => {
    const registry = new ProviderRegistry("a");
    const provider = fakeProvider("a", "model-a");
    registry.register(provider);

    expect(registry.get("a")).toBe(provider);
    expect(registry.get("missing")).toBeUndefined();
  });

  it("lists all registered providers", () => {
    const registry = new ProviderRegistry("a");
    const a = fakeProvider("a", "model-a");
    const b = fakeProvider("b", "model-b");
    registry.register(a);
    registry.register(b);

    expect(registry.list()).toEqual([a, b]);
  });

  it("returns the provider matching the configured default id", () => {
    const registry = new ProviderRegistry("b");
    registry.register(fakeProvider("a", "model-a"));
    const b = fakeProvider("b", "model-b");
    registry.register(b);

    expect(registry.getDefault()).toBe(b);
    expect(registry.getDefaultId()).toBe("b");
  });

  it("throws when the default id was never registered", () => {
    const registry = new ProviderRegistry("missing");
    registry.register(fakeProvider("a", "model-a"));

    expect(() => registry.getDefault()).toThrow('Default provider "missing" is not registered');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd packages/agent-core
npx vitest run src/ProviderRegistry.test.ts
```

Expected: FAIL — `Cannot find module './ProviderRegistry.js'`.

- [x] **Step 3: Implement `ProviderRegistry.ts`**

```ts
// packages/agent-core/src/ProviderRegistry.ts
import type { LlmProvider } from "./types.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  constructor(private readonly defaultProviderId: string) {}

  register(provider: LlmProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): LlmProvider | undefined {
    return this.providers.get(id);
  }

  list(): LlmProvider[] {
    return [...this.providers.values()];
  }

  getDefaultId(): string {
    return this.defaultProviderId;
  }

  getDefault(): LlmProvider {
    const provider = this.providers.get(this.defaultProviderId);
    if (!provider) {
      throw new Error(`Default provider "${this.defaultProviderId}" is not registered`);
    }
    return provider;
  }
}
```

- [x] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/ProviderRegistry.test.ts
```

Expected: all 4 tests PASS.

- [x] **Step 5: Export it from the barrel**

```ts
// packages/agent-core/src/index.ts
export * from "./types.js";
export * from "./ContextBuilder.js";
export * from "./ProviderRegistry.js";
export * from "./AgentRuntime.js";
```

- [x] **Step 6: Typecheck, lint, test the whole package**

```bash
cd ../..
npm run typecheck --workspace=@agenter/agent-core
npm run test --workspace=@agenter/agent-core
npm run lint
```

Expected: no errors, all tests pass.

- [x] **Step 7: Commit**

```bash
git add packages/agent-core
git commit -m "feat(agent-core): add ProviderRegistry"
```

---

## Task 2: agent-core — AgentRuntime selects from ProviderRegistry

**Files:**
- Modify: `packages/agent-core/src/AgentRuntime.ts`
- Modify: `packages/agent-core/src/AgentRuntime.test.ts`

**Interfaces:**
- Consumes: `ProviderRegistry` (Task 1).
- Produces: `class AgentRuntime` with constructor `(registry: ProviderRegistry, storage: ChatStorage, systemPrompt?: string)` and `runTurn(chatId: string, userMessage: string, providerId?: string): AsyncGenerator<AgentEvent>`. Task 5 (`apps/api`) constructs one `AgentRuntime` per process with the full registry (not a single provider), and `ChatService.sendMessage` forwards an optional `providerId` through to it.

- [x] **Step 1: Replace the contents of `AgentRuntime.test.ts`**

```ts
// packages/agent-core/src/AgentRuntime.test.ts
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./AgentRuntime.js";
import { ProviderRegistry } from "./ProviderRegistry.js";
import type { ChatStorage, LlmEvent, LlmProvider, LlmRequest, StoredMessage } from "./types.js";

function fakeStorage(initialHistory: StoredMessage[] = []): ChatStorage {
  const history = [...initialHistory];
  return {
    createChat: vi.fn(),
    listChats: vi.fn(() => []),
    getChat: vi.fn(),
    deleteChat: vi.fn(),
    touchChat: vi.fn(),
    listMessages: vi.fn(() => history),
    addMessage: vi.fn((input) => {
      const stored: StoredMessage = {
        id: `m${history.length + 1}`,
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        provider: input.provider ?? null,
        model: input.model ?? null,
        createdAt: new Date().toISOString(),
      };
      history.push(stored);
      return stored;
    }),
    addRun: vi.fn((input) => ({
      id: "r1",
      chatId: input.chatId,
      messageId: input.messageId,
      provider: input.provider,
      model: input.model,
      status: input.status,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      durationMs: input.durationMs,
      createdAt: new Date().toISOString(),
    })),
  };
}

function fakeProvider(id: string, model: string, events: LlmEvent[]): LlmProvider {
  return {
    id,
    model,
    supportsTools: () => false,
    supportsVision: () => false,
    getContextWindow: () => 8192,
    async *chat(_request: LlmRequest): AsyncIterable<LlmEvent> {
      for (const event of events) {
        yield event;
      }
    },
  };
}

function registryWith(providers: LlmProvider[], defaultProviderId: string): ProviderRegistry {
  const registry = new ProviderRegistry(defaultProviderId);
  for (const provider of providers) registry.register(provider);
  return registry;
}

describe("AgentRuntime.runTurn", () => {
  it("uses the registry's default provider when none is named", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "done", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);
    const registry = registryWith([provider], "fake");
    const runtime = new AgentRuntime(registry, storage, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.started", provider: "fake", model: "fake-model" },
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "run.completed", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);

    expect(storage.addMessage).toHaveBeenNthCalledWith(1, {
      chatId: "chat-1",
      role: "user",
      content: "hi",
    });
    expect(storage.addMessage).toHaveBeenNthCalledWith(2, {
      chatId: "chat-1",
      role: "assistant",
      content: "Hello!",
      provider: "fake",
      model: "fake-model",
    });
    expect(storage.addRun).toHaveBeenCalledOnce();
  });

  it("uses the named provider when providerId is given", async () => {
    const storage = fakeStorage();
    const defaultProvider = fakeProvider("default-one", "default-model", []);
    const namedProvider = fakeProvider("other", "other-model", [
      { type: "text.delta", text: "Hi" },
      { type: "done" },
    ]);
    const registry = registryWith([defaultProvider, namedProvider], "default-one");
    const runtime = new AgentRuntime(registry, storage, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", "other")) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "run.started", provider: "other", model: "other-model" });
  });

  it("emits run.error and persists no assistant message when providerId is unknown", async () => {
    const storage = fakeStorage();
    const registry = registryWith([fakeProvider("fake", "fake-model", [])], "fake");
    const runtime = new AgentRuntime(registry, storage, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", "unknown-provider")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.error", message: 'Unknown provider "unknown-provider"' },
    ]);
    expect(storage.addMessage).toHaveBeenCalledOnce();
    expect(storage.addMessage).toHaveBeenCalledWith({
      chatId: "chat-1",
      role: "user",
      content: "hi",
    });
    expect(storage.addRun).not.toHaveBeenCalled();
  });

  it("emits run.error and does not persist an assistant message when the provider errors", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [{ type: "error", message: "upstream down" }]);
    const registry = registryWith([provider], "fake");
    const runtime = new AgentRuntime(registry, storage, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.started", provider: "fake", model: "fake-model" },
      { type: "run.error", message: "upstream down" },
    ]);

    expect(storage.addMessage).toHaveBeenCalledOnce();
    expect(storage.addMessage).toHaveBeenCalledWith({
      chatId: "chat-1",
      role: "user",
      content: "hi",
    });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd packages/agent-core
npx vitest run src/AgentRuntime.test.ts
```

Expected: FAIL — `AgentRuntime`'s constructor still expects `(provider, storage, systemPrompt?)`, so passing a `ProviderRegistry` as the first argument breaks the "named provider"/"unknown provider" assertions.

- [x] **Step 3: Update `AgentRuntime.ts`**

```ts
// packages/agent-core/src/AgentRuntime.ts
import { buildContext } from "./ContextBuilder.js";
import type { ProviderRegistry } from "./ProviderRegistry.js";
import type { AgentEvent, ChatStorage } from "./types.js";

export class AgentRuntime {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly storage: ChatStorage,
    private readonly systemPrompt: string = "You are a helpful assistant."
  ) {}

  async *runTurn(chatId: string, userMessage: string, providerId?: string): AsyncGenerator<AgentEvent> {
    const history = this.storage.listMessages(chatId);
    const storedUserMessage = this.storage.addMessage({ chatId, role: "user", content: userMessage });

    const provider = providerId ? this.registry.get(providerId) : this.registry.getDefault();
    if (!provider) {
      yield { type: "run.error", message: `Unknown provider "${providerId}"` };
      return;
    }

    const context = buildContext({
      systemPrompt: this.systemPrompt,
      history,
      currentMessage: userMessage,
    });

    yield { type: "run.started", provider: provider.id, model: provider.model };

    const startedAt = Date.now();
    let assistantText = "";

    for await (const event of provider.chat({ messages: context })) {
      if (event.type === "text.delta") {
        assistantText += event.text;
        yield { type: "text.delta", text: event.text };
        continue;
      }

      if (event.type === "error") {
        this.storage.addRun({
          chatId,
          messageId: storedUserMessage.id,
          provider: provider.id,
          model: provider.model,
          status: "error",
          durationMs: Date.now() - startedAt,
        });
        yield { type: "run.error", message: event.message };
        return;
      }

      this.storage.addMessage({
        chatId,
        role: "assistant",
        content: assistantText,
        provider: provider.id,
        model: provider.model,
      });

      this.storage.addRun({
        chatId,
        messageId: storedUserMessage.id,
        provider: provider.id,
        model: provider.model,
        status: "success",
        tokensIn: event.usage?.promptTokens,
        tokensOut: event.usage?.completionTokens,
        durationMs: Date.now() - startedAt,
      });

      this.storage.touchChat(chatId);

      yield { type: "run.completed", usage: event.usage };
    }
  }
}
```

- [x] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/AgentRuntime.test.ts
```

Expected: all 4 tests PASS.

- [x] **Step 5: Typecheck, lint, test the whole package**

```bash
cd ../..
npm run typecheck --workspace=@agenter/agent-core
npm run test --workspace=@agenter/agent-core
npm run lint
```

Expected: no errors, all tests pass.

- [x] **Step 6: Commit**

```bash
git add packages/agent-core
git commit -m "feat(agent-core): AgentRuntime selects provider from ProviderRegistry"
```

---

## Task 3: apps/api — YAML provider config with env-var interpolation

**Files:**
- Create: `config/providers.yaml`
- Modify: `.env.example`
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/src/config.test.ts` (new)
- Modify: `apps/api/package.json` (add `yaml` dependency)

**Interfaces:**
- Consumes: nothing new.
- Produces: `interface ProviderConfigEntry { id: string; type: "openai-compatible"; baseUrl: string; apiKey: string; model: string; contextWindow?: number }`, `interface AppConfig { port: number; dbPath: string; providers: ProviderConfigEntry[]; defaultProviderId: string }`, `loadConfig(): AppConfig`, `loadConfigFromFile(path: string): { providers: ProviderConfigEntry[]; defaultProviderId: string }`, and `interpolateEnv(value: string): string` (all exported, the last two for the test). Task 4 (`providerFactory.ts`) consumes `AppConfig.providers` and `AppConfig.defaultProviderId`.

- [x] **Step 1: Add the `yaml` dependency**

```bash
npm install yaml@2.9.1 --workspace=@agenter/api --save-exact
```

- [x] **Step 2: Create `config/providers.yaml`**

```yaml
defaultProvider: local-fast

providers:
  local-fast:
    type: openai-compatible
    baseUrl: http://localhost:1234/v1
    apiKey: local
    model: qwen3.5-9b

  local-code:
    type: openai-compatible
    baseUrl: http://localhost:1234/v1
    apiKey: local
    model: qwen3-coder-30b-a3b
```

This mirrors PROMT.md §5's own example exactly (`local-fast` / `local-code`, both `openai-compatible`, sharing a `baseUrl` — the same LM Studio-style server hosting two loaded models) plus a top-level `defaultProvider` key the spec's snippet doesn't show but which Phase 2 needs (no router yet to pick one at request time). Adjust `baseUrl`/`model` values to match whatever's actually running locally when following this plan.

- [x] **Step 3: Update `.env.example`**

Replace the `PROVIDER_*` block:

```text
PORT=3000
DB_PATH=./data/agenter.db
```

(No secrets needed for local OpenAI-compatible servers using a placeholder key like `local`. If a configured provider ever needs a real key, add it here as `SOME_PROVIDER_API_KEY=` and reference it from `config/providers.yaml` as `apiKey: ${SOME_PROVIDER_API_KEY}`.)

- [x] **Step 4: Write the failing test for env interpolation and YAML loading**

```ts
// apps/api/src/config.test.ts
import { writeFileSync, unlinkSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { interpolateEnv, loadConfigFromFile } from "./config.js";

describe("interpolateEnv", () => {
  it("replaces ${VAR} with the environment variable value", () => {
    process.env.TEST_INTERPOLATE_VAR = "resolved-value";
    expect(interpolateEnv("${TEST_INTERPOLATE_VAR}")).toBe("resolved-value");
    delete process.env.TEST_INTERPOLATE_VAR;
  });

  it("leaves a literal string unchanged when it has no ${...} placeholder", () => {
    expect(interpolateEnv("local")).toBe("local");
  });

  it("throws when the referenced environment variable is not set", () => {
    delete process.env.TEST_MISSING_VAR;
    expect(() => interpolateEnv("${TEST_MISSING_VAR}")).toThrow(
      "Missing required environment variable: TEST_MISSING_VAR"
    );
  });
});

describe("loadConfigFromFile", () => {
  const filePath = "./.tmp-test-providers.yaml";

  afterEach(() => {
    unlinkSync(filePath);
  });

  it("parses providers.yaml, resolves ${VAR} placeholders, and reports the default provider", () => {
    writeFileSync(
      filePath,
      [
        "defaultProvider: local-fast",
        "providers:",
        "  local-fast:",
        "    type: openai-compatible",
        "    baseUrl: http://localhost:1234/v1",
        "    apiKey: local",
        "    model: qwen3",
        "  local-code:",
        "    type: openai-compatible",
        "    baseUrl: http://localhost:1234/v1",
        "    apiKey: local",
        "    model: qwen3-coder-30b",
        "",
      ].join("\n")
    );

    const config = loadConfigFromFile(filePath);

    expect(config.defaultProviderId).toBe("local-fast");
    expect(config.providers).toEqual([
      {
        id: "local-fast",
        type: "openai-compatible",
        baseUrl: "http://localhost:1234/v1",
        apiKey: "local",
        model: "qwen3",
        contextWindow: undefined,
      },
      {
        id: "local-code",
        type: "openai-compatible",
        baseUrl: "http://localhost:1234/v1",
        apiKey: "local",
        model: "qwen3-coder-30b",
        contextWindow: undefined,
      },
    ]);
  });

  it("resolves an apiKey given as ${VAR} from the environment", () => {
    process.env.TEST_PROVIDER_KEY = "sk-resolved";
    writeFileSync(
      filePath,
      [
        "defaultProvider: remote",
        "providers:",
        "  remote:",
        "    type: openai-compatible",
        "    baseUrl: https://api.example.com/v1",
        "    apiKey: ${TEST_PROVIDER_KEY}",
        "    model: some-model",
        "",
      ].join("\n")
    );

    const config = loadConfigFromFile(filePath);

    expect(config.providers[0]?.apiKey).toBe("sk-resolved");
    delete process.env.TEST_PROVIDER_KEY;
  });
});
```

- [x] **Step 5: Run test to verify it fails**

```bash
cd apps/api
npx vitest run src/config.test.ts
```

Expected: FAIL — `interpolateEnv`/`loadConfigFromFile` are not exported yet.

- [x] **Step 6: Rewrite `config.ts`**

```ts
// apps/api/src/config.ts
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

export interface ProviderConfigEntry {
  id: string;
  type: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow?: number;
}

export interface AppConfig {
  port: number;
  dbPath: string;
  providers: ProviderConfigEntry[];
  defaultProviderId: string;
}

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

export function interpolateEnv(value: string): string {
  const match = ENV_PLACEHOLDER.exec(value);
  if (!match) return value;

  const varName = match[1] as string;
  const resolved = process.env[varName];
  if (!resolved) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
  return resolved;
}

interface RawProvidersYaml {
  defaultProvider: string;
  providers: Record<
    string,
    { type: "openai-compatible"; baseUrl: string; apiKey: string; model: string; contextWindow?: number }
  >;
}

export function loadConfigFromFile(providersYamlPath: string): {
  providers: ProviderConfigEntry[];
  defaultProviderId: string;
} {
  const raw = parseYaml(readFileSync(providersYamlPath, "utf-8")) as RawProvidersYaml;

  const providers: ProviderConfigEntry[] = Object.entries(raw.providers).map(([id, entry]) => ({
    id,
    type: entry.type,
    baseUrl: entry.baseUrl,
    apiKey: interpolateEnv(entry.apiKey),
    model: entry.model,
    contextWindow: entry.contextWindow,
  }));

  return { providers, defaultProviderId: raw.defaultProvider };
}

export function loadConfig(): AppConfig {
  const providersYamlPath = path.resolve(__dirname, "../../../config/providers.yaml");
  const { providers, defaultProviderId } = loadConfigFromFile(providersYamlPath);

  return {
    port: Number(process.env.PORT ?? "3000"),
    dbPath: process.env.DB_PATH ?? "./data/agenter.db",
    providers,
    defaultProviderId,
  };
}
```

- [x] **Step 7: Run test again, confirm it passes**

```bash
npx vitest run src/config.test.ts
```

Expected: all 5 tests PASS.

- [x] **Step 8: Typecheck and lint**

```bash
cd ../..
npm install
npm run typecheck --workspace=@agenter/api
npm run lint
```

Expected: no errors. (`loadConfig()` itself isn't called by any test yet — it's exercised in Task 5's bootstrap.)

- [x] **Step 9: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/config.test.ts apps/api/package.json config/providers.yaml .env.example package-lock.json
git commit -m "feat(api): load provider config from YAML with env-var interpolation"
```

---

## Task 4: apps/api — providerFactory builds a ProviderRegistry from config

**Files:**
- Create: `apps/api/src/providerFactory.ts`
- Test: `apps/api/src/providerFactory.test.ts` (new)

**Interfaces:**
- Consumes: `ProviderRegistry` from `@agenter/agent-core` (Task 1), `OpenAICompatibleProvider` from `@agenter/provider-openai-compatible`, `ProviderConfigEntry`/`AppConfig` from `./config.js` (Task 3).
- Produces: `function buildProviderRegistry(config: Pick<AppConfig, "providers" | "defaultProviderId">): ProviderRegistry` (consumed by Task 5's `index.ts` bootstrap).

This is the one file in `apps/api` allowed to import the concrete `OpenAICompatibleProvider` class — everything downstream (`ChatService`, `AgentRuntime`) only sees `ProviderRegistry`/`LlmProvider`.

- [x] **Step 1: Write the failing test**

```ts
// apps/api/src/providerFactory.test.ts
import { describe, expect, it } from "vitest";
import { buildProviderRegistry } from "./providerFactory.js";
import type { ProviderConfigEntry } from "./config.js";

const providers: ProviderConfigEntry[] = [
  {
    id: "local-fast",
    type: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    apiKey: "local",
    model: "qwen3.5-9b",
  },
  {
    id: "local-code",
    type: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    apiKey: "local",
    model: "qwen3-coder-30b-a3b",
  },
];

describe("buildProviderRegistry", () => {
  it("registers one provider per config entry, keyed by id", () => {
    const registry = buildProviderRegistry({ providers, defaultProviderId: "local-fast" });

    expect(registry.list().map((p) => p.id)).toEqual(["local-fast", "local-code"]);
  });

  it("sets the model on each provider from its config entry", () => {
    const registry = buildProviderRegistry({ providers, defaultProviderId: "local-fast" });

    expect(registry.get("local-code")?.model).toBe("qwen3-coder-30b-a3b");
  });

  it("wires the configured defaultProviderId into the registry's default", () => {
    const registry = buildProviderRegistry({ providers, defaultProviderId: "local-code" });

    expect(registry.getDefault().id).toBe("local-code");
  });

  it("throws if defaultProviderId doesn't match any configured provider", () => {
    expect(() =>
      buildProviderRegistry({ providers, defaultProviderId: "missing" })
    ).toThrow('Default provider "missing" is not registered');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run src/providerFactory.test.ts
```

Expected: FAIL — `./providerFactory.js` doesn't exist yet.

- [x] **Step 3: Implement `providerFactory.ts`**

```ts
// apps/api/src/providerFactory.ts
import { ProviderRegistry } from "@agenter/agent-core";
import { OpenAICompatibleProvider } from "@agenter/provider-openai-compatible";
import type { ProviderConfigEntry } from "./config.js";

export function buildProviderRegistry(config: {
  providers: ProviderConfigEntry[];
  defaultProviderId: string;
}): ProviderRegistry {
  const registry = new ProviderRegistry(config.defaultProviderId);

  for (const entry of config.providers) {
    const provider = new OpenAICompatibleProvider({
      id: entry.id,
      baseUrl: entry.baseUrl,
      apiKey: entry.apiKey,
      model: entry.model,
      contextWindow: entry.contextWindow,
    });
    registry.register(provider);
  }

  registry.getDefault();

  return registry;
}
```

`ProviderRegistry`'s constructor (Task 1) takes `defaultProviderId` up front; `getDefault()` throws `Default provider "<id>" is not registered` if no registered provider matches it. Calling it once here — after all entries are registered — turns a misconfigured `defaultProvider` in `providers.yaml` into an immediate startup failure instead of a silent one that only surfaces on the first request.

- [x] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/providerFactory.test.ts
```

Expected: all 4 tests PASS.

- [x] **Step 5: Typecheck, lint, full workspace test**

```bash
cd ../..
npm run typecheck --workspace=@agenter/api
npm run lint
npm test
```

Expected: no errors, all tests across the workspace PASS.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/providerFactory.ts apps/api/src/providerFactory.test.ts
git commit -m "feat(api): build ProviderRegistry from config"
```

---

## Task 5: apps/api — wire ChatService, routes, and bootstrap to the registry

**Files:**
- Modify: `apps/api/src/services/ChatService.ts`
- Modify: `apps/api/src/routes/messages.ts`
- Modify: `apps/api/src/routes/providers.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `AgentRuntime` with the new `(registry, storage, systemPrompt?)` constructor and `runTurn(chatId, userMessage, providerId?)` signature (Task 2), `buildProviderRegistry` (Task 4), `loadConfig` (Task 3).
- Produces: `ChatService.sendMessage(chatId: string, content: string, providerId?: string): AsyncGenerator<AgentEvent>` (consumed by `routes/messages.ts`); `GET /api/providers` responds `{ providers: { id: string; model: string }[]; defaultProviderId: string }`.

- [x] **Step 1: Update `ChatService.sendMessage` to accept and forward `providerId`**

In `apps/api/src/services/ChatService.ts`, change:

```ts
sendMessage(chatId: string, content: string) {
  return this.runtime.runTurn(chatId, content);
}
```

to:

```ts
sendMessage(chatId: string, content: string, providerId?: string) {
  return this.runtime.runTurn(chatId, content, providerId);
}
```

(Match whatever the surrounding method looks like exactly — this is a one-line signature/call change, no other logic in `ChatService` needs to move.)

- [x] **Step 2: Update `routes/messages.ts` to read `providerId` from the request body**

Find where the current handler destructures the POST body (e.g. `const { content } = req.body;`) and change it to also read `providerId`:

```ts
const { content, providerId } = req.body as { content?: string; providerId?: string };
```

Then pass it through to `chatService.sendMessage(chatId, content, providerId)`. Leave existing validation (missing/empty `content`) untouched; `providerId` is optional and falls through to `AgentRuntime`'s default-provider path when omitted.

- [x] **Step 3: Update `routes/providers.ts` to report all registered providers plus the default**

Replace its current body with a handler that reads from the `ProviderRegistry` (passed in via whatever DI the route module already uses to reach `AgentRuntime`/services — follow the existing pattern in this file for how it gets access to shared state, e.g. a factory function taking dependencies):

```ts
router.get("/providers", (_req, res) => {
  res.json({
    providers: registry.list().map((p) => ({ id: p.id, model: p.model })),
    defaultProviderId: registry.getDefaultId(),
  });
});
```

- [x] **Step 4: Update `apps/api/src/index.ts` bootstrap**

Replace the current single-provider construction:

```ts
const provider = new OpenAICompatibleProvider(/* ... */);
const runtime = new AgentRuntime(provider, storage);
```

with:

```ts
const config = loadConfig();
const registry = buildProviderRegistry(config);
const runtime = new AgentRuntime(registry, storage);
```

and thread `registry` through to wherever `routes/providers.ts` is mounted (following the existing route-wiring pattern in this file — e.g. if routes are built via a factory function like `createProvidersRouter(registry)`, update that call site).

- [x] **Step 5: Manual verification**

Start the API against `config/providers.yaml`'s two entries (adjust `baseUrl`/model to whatever's actually running locally):

```bash
npm run dev --workspace=@agenter/api
```

In another terminal, confirm both providers are listed:

```bash
curl http://localhost:3000/api/providers
```

Expected: `{"providers":[{"id":"local-fast","model":"..."},{"id":"local-code","model":"..."}],"defaultProviderId":"local-fast"}`.

Create a chat, then send one message with no `providerId` (uses the default) and one with an explicit `providerId` targeting the other entry:

```bash
CHAT_ID=$(curl -s -X POST http://localhost:3000/api/chats -H 'Content-Type: application/json' -d '{"title":"test"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')

curl -N -X POST "http://localhost:3000/api/chats/$CHAT_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"hi"}'

curl -N -X POST "http://localhost:3000/api/chats/$CHAT_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"hi again","providerId":"local-code"}'
```

Expected: both requests stream `run.started` (check the `provider`/`model` fields differ between the two responses) followed by `text.delta` events and a `run.completed`. Stop the dev server (`Ctrl+C`) once confirmed.

- [x] **Step 6: Typecheck, lint, full workspace test**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: no errors, all tests PASS.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/services/ChatService.ts apps/api/src/routes/messages.ts apps/api/src/routes/providers.ts apps/api/src/index.ts
git commit -m "feat(api): wire ProviderRegistry through ChatService, routes, and bootstrap"
```

---

## Self-review

**Spec coverage:** PROMT.md §4 (provider abstraction) is covered by Task 1/2 (`LlmProvider`/`ProviderRegistry` already existed/added) and Task 4 (`OpenAICompatibleProvider` construction, unchanged implementation). §5 (YAML provider config with `${VAR}` interpolation, `defaultProvider` key) is covered by Task 3, using the spec's own two-openai-compatible-provider example verbatim. The ability to address a specific provider per request — the user's explicit ask — is covered end-to-end: `ProviderRegistry` (Task 1) → `AgentRuntime.runTurn(chatId, userMessage, providerId?)` (Task 2) → `ChatService.sendMessage(chatId, content, providerId?)` → `POST /messages` body (Task 5). `AnthropicProvider` (part of §4's own text) is intentionally excluded per the user's explicit correction; the `type: "openai-compatible"` discriminator is kept in `ProviderConfigEntry` so a later phase can add an `"anthropic"` variant without reshaping this config. §6 (`ProviderRouter` — automatic provider selection by policy/cost/rules) and §14 (frontend model selector UI) are explicitly out of scope for this plan and deferred to later phases, as stated in the Architecture section.

**Placeholder scan:** no "TBD"/"TODO"/"add appropriate handling" language found.

**Type consistency:** `ProviderConfigEntry` (Task 3) → consumed identically in Task 4's test fixtures and `buildProviderRegistry` signature. `AppConfig.providers`/`AppConfig.defaultProviderId` (Task 3) match the `Pick<AppConfig, "providers" | "defaultProviderId">` parameter type in Task 4. `AgentRuntime`'s constructor `(registry: ProviderRegistry, storage: ChatStorage, systemPrompt?)` (Task 2) matches its use in Task 5 Step 4. `ChatService.sendMessage(chatId, content, providerId?)` (Task 5 Step 1) matches the call in Task 5 Step 2 and the manual-verification body shape in Step 5.
