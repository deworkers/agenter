# Phase 2: Provider Abstraction, Anthropic Provider & Provider Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the app run with more than one configured LLM provider — add `AnthropicProvider` alongside the existing `OpenAICompatibleProvider`, introduce a `ProviderRegistry` that `AgentRuntime` selects from, and move provider configuration out of flat env vars into `config/providers.yaml` with `${VAR}` env-var interpolation, per PROMT.md §4/§5.

**Architecture:** `ProviderRegistry` (new, in `packages/agent-core`) holds `LlmProvider` instances keyed by id and knows which one is the configured default; it only ever sees the `LlmProvider` interface, never concrete provider classes. `AgentRuntime.runTurn` gains an optional `providerId` parameter — when given, it looks up that provider in the registry; when omitted, it uses the registry's default. `apps/api` (the composition root) is the only place that imports concrete provider classes (`OpenAICompatibleProvider`, `AnthropicProvider`) and registers instances into the registry, via a new `providerFactory.ts`. Configuration moves from `PROVIDER_*` env vars to `config/providers.yaml`, parsed and env-interpolated by a rewritten `apps/api/src/config.ts`. No `ProviderRouter`, no `TaskType`, no `routing.yaml` yet — those are Phase 3.

**Tech Stack:** Same as Phase 1 (Node.js with `node:sqlite`, TypeScript strict, Express, Vitest, npm workspaces), plus two new exact-pinned dependencies: `@anthropic-ai/sdk` (in `packages/providers/anthropic`) and `yaml` (in `apps/api`).

**Spec:** `PROMT.md` §4 (Provider abstraction, `AnthropicProvider`), §5 (`ProviderRegistry`, YAML config, env var interpolation, no secrets in git). §6 (`ProviderRouter`) is explicitly deferred to the Phase 3 plan.

## Global Constraints

- Node.js >=24.0.0, using built-in `node:sqlite` — unchanged from Phase 1.
- TypeScript strict mode (`tsconfig.base.json`) — every new/modified package extends it unchanged.
- All new dependencies pinned to an exact version (no `^`/`~` ranges) via `npm install <pkg> --save-exact`, matching every existing dependency in this repo.
- No real API keys committed to git. Real secrets (e.g. `ANTHROPIC_API_KEY`) are referenced from `config/providers.yaml` as `${ANTHROPIC_API_KEY}` and resolved from `.env` at load time; only non-secret placeholder values (e.g. `apiKey: local` for a local server) may be literal in `config/providers.yaml`.
- `AgentRuntime` and all of `packages/agent-core` stay provider-agnostic — they depend only on the `LlmProvider` interface, never on `OpenAICompatibleProvider`/`AnthropicProvider` directly (PROMT.md §4).
- Vitest for all tests, mirroring each package's existing `test` script (`vitest run`).
- Every package's `tsconfig.json` extends `tsconfig.base.json` and every `package.json` follows the existing shape (`private: true`, `type: module`, `main`/`types` → `./src/index.ts`, `typecheck`/`test` scripts).

## Decisions worth flagging

- **`AnthropicProvider` uses the official `@anthropic-ai/sdk`, not raw `fetch`** — unlike `OpenAICompatibleProvider`. Anthropic's streaming protocol has several event types (`message_start`, `content_block_delta`, `message_delta`, `message_stop`) versus OpenAI's single delta-chunk shape; hand-rolling that parser would duplicate logic the official SDK already handles. PROMT.md §1 lists "Anthropic API" as a first-class tech-stack item without forbidding its SDK, and §25 only warns against adding a dependency when standard means already solve the problem — here they don't.
- **`ProviderRegistry` lives in `packages/agent-core`**, alongside `AgentRuntime`/`ContextBuilder`, since PROMT.md §3 groups it with the other core orchestration components. It is constructed and populated with `LlmProvider` instances only — `apps/api`'s new `providerFactory.ts` is the only file that imports both concrete provider classes.
- **`AgentRuntime.runTurn` gains an optional `providerId` parameter now**, even though `ProviderRouter` (manual/auto mode) is Phase 3. Without this, Phase 3 would have to change `AgentRuntime`'s signature again. Phase 2 adds no `TaskType`/auto-routing logic — a caller either names a provider or gets the configured default.
- **Config moves from flat `PROVIDER_*` env vars to `config/providers.yaml`**, matching PROMT.md §5's example exactly, plus one key the spec's example doesn't show: a top-level `defaultProvider`. This is needed because Phase 2 has no router to decide which provider handles a request when the caller doesn't name one.
- **An unknown `providerId` yields a `run.error` event without ever calling `storage.addRun`** — a "run" row represents an attempted provider call, and none happened here. The triggering user message is still persisted, consistent with the existing pattern where a mid-stream provider error also leaves the user message persisted.
- **`GET /api/providers`'s response shape changes** from a bare array to `{ providers: [...], defaultProviderId }`. Safe because nothing in `apps/web` calls this endpoint yet (confirmed — no model selector exists; that UI is Phase 8 per PROMT.md §24).
- **No `apps/web` changes in this plan.** The frontend model selector is explicitly Phase 8 (§24); this plan is backend-only.

---

## File Structure

```text
agenter/
├── config/
│   └── providers.yaml                     NEW — multi-provider config, env-var interpolated
├── .env.example                            MODIFIED — drop PROVIDER_*, add ANTHROPIC_API_KEY
│
├── packages/
│   ├── agent-core/
│   │   └── src/
│   │       ├── ProviderRegistry.ts         NEW
│   │       ├── ProviderRegistry.test.ts    NEW
│   │       ├── AgentRuntime.ts             MODIFIED — takes ProviderRegistry, optional providerId
│   │       ├── AgentRuntime.test.ts        MODIFIED
│   │       └── index.ts                   MODIFIED — export ProviderRegistry
│   │
│   └── providers/
│       └── anthropic/                      NEW package
│           ├── package.json
│           ├── tsconfig.json
│           └── src/
│               ├── AnthropicProvider.ts
│               ├── AnthropicProvider.test.ts
│               └── index.ts
│
└── apps/
    └── api/
        └── src/
            ├── config.ts                   MODIFIED — YAML + env interpolation
            ├── config.test.ts              NEW
            ├── providerFactory.ts          NEW
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

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agent-core
npx vitest run src/ProviderRegistry.test.ts
```

Expected: FAIL — `Cannot find module './ProviderRegistry.js'`.

- [ ] **Step 3: Implement `ProviderRegistry.ts`**

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

- [ ] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/ProviderRegistry.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Export it from the barrel**

```ts
// packages/agent-core/src/index.ts
export * from "./types.js";
export * from "./ContextBuilder.js";
export * from "./ProviderRegistry.js";
export * from "./AgentRuntime.js";
```

- [ ] **Step 6: Typecheck, lint, test the whole package**

```bash
cd ../..
npm run typecheck --workspace=@agenter/agent-core
npm run test --workspace=@agenter/agent-core
npm run lint
```

Expected: no errors, all tests pass.

- [ ] **Step 7: Commit**

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
- Produces: `class AgentRuntime` with constructor `(registry: ProviderRegistry, storage: ChatStorage, systemPrompt?: string)` and `runTurn(chatId: string, userMessage: string, providerId?: string): AsyncGenerator<AgentEvent>`. Task 5 (`apps/api`) constructs one `AgentRuntime` per process with the full registry (not one provider), and `ChatService.sendMessage` forwards an optional `providerId` through to it.

- [ ] **Step 1: Update the failing test to construct `AgentRuntime` with a registry**

Replace the full contents of `packages/agent-core/src/AgentRuntime.test.ts` with:

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

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agent-core
npx vitest run src/AgentRuntime.test.ts
```

Expected: FAIL — `AgentRuntime` constructor still expects `(provider, storage, systemPrompt?)`, so `registryWith(...)` passed as first arg breaks the "uses named provider"/"unknown provider" assertions (TypeScript compile error under `vitest run`, or a runtime error since `this.provider` would be a `ProviderRegistry` without `.chat()`).

- [ ] **Step 3: Update `AgentRuntime.ts`**

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

- [ ] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/AgentRuntime.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Typecheck, lint, test the whole package**

```bash
cd ../..
npm run typecheck --workspace=@agenter/agent-core
npm run test --workspace=@agenter/agent-core
npm run lint
```

Expected: no errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core
git commit -m "feat(agent-core): AgentRuntime selects provider from ProviderRegistry"
```

---

## Task 3: providers/anthropic — AnthropicProvider

**Files:**
- Create: `packages/providers/anthropic/package.json`
- Create: `packages/providers/anthropic/tsconfig.json`
- Create: `packages/providers/anthropic/src/AnthropicProvider.ts`
- Test: `packages/providers/anthropic/src/AnthropicProvider.test.ts`
- Create: `packages/providers/anthropic/src/index.ts`

**Interfaces:**
- Consumes: `LlmProvider`, `LlmRequest`, `LlmEvent` (from `@agenter/agent-core`, existing).
- Produces: `class AnthropicProvider implements LlmProvider` with constructor `(config: { id: string; apiKey: string; model: string; contextWindow?: number })`. Task 6 (`apps/api`'s `providerFactory.ts`) constructs one per `type: anthropic` entry in `config/providers.yaml`.

This provider wraps `@anthropic-ai/sdk`'s `client.messages.stream(...)`, translating its streaming events into the same `LlmEvent` union `OpenAICompatibleProvider` already produces (`text.delta`, `done`, `error`) — `AgentRuntime` and everything downstream cannot tell which concrete provider is in use.

- [ ] **Step 1: Add the dependency**

```bash
npm install @anthropic-ai/sdk@0.126.0 --workspace=@agenter/provider-anthropic --save-exact
```

Note: this command is run *after* Step 2 creates the package directory and a minimal `package.json` — npm workspaces requires the workspace to already exist on disk to target it by name. If run before Step 2, create the package.json first (Step 2) then re-run this install.

- [ ] **Step 2: Create `packages/providers/anthropic/package.json`**

```json
{
  "name": "@agenter/provider-anthropic",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@agenter/agent-core": "0.1.0",
    "@anthropic-ai/sdk": "0.126.0"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vitest": "5.0.0"
  }
}
```

(Run the Step 1 install now if not already done, so `node_modules` actually has the package.)

- [ ] **Step 3: Create `packages/providers/anthropic/tsconfig.json`**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write the failing test**

```ts
// packages/providers/anthropic/src/AnthropicProvider.test.ts
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "./AnthropicProvider.js";

const streamMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { stream: streamMock };
    },
  };
});

function fakeStream(events: Array<Record<string, unknown>>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

describe("AnthropicProvider", () => {
  it("yields text.delta for each content_block_delta and done with usage on message_delta", async () => {
    streamMock.mockReturnValue(
      fakeStream([
        { type: "message_start", message: { usage: { input_tokens: 12 } } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "lo!" } },
        { type: "message_delta", usage: { output_tokens: 4 } },
        { type: "message_stop" },
      ])
    );

    const provider = new AnthropicProvider({ id: "claude", apiKey: "test-key", model: "claude-test" });

    const events = [];
    for await (const event of provider.chat({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "done", usage: { promptTokens: 12, completionTokens: 4 } },
    ]);
  });

  it("splits a system message out of the messages array before calling the SDK", async () => {
    streamMock.mockReturnValue(fakeStream([{ type: "message_stop" }]));

    const provider = new AnthropicProvider({ id: "claude", apiKey: "test-key", model: "claude-test" });

    const events = [];
    for await (const event of provider.chat({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hi" },
      ],
    })) {
      events.push(event);
    }

    expect(streamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "You are helpful.",
        messages: [{ role: "user", content: "hi" }],
      })
    );
  });

  it("yields an error event when the SDK stream throws", async () => {
    streamMock.mockImplementation(() => {
      throw new Error("invalid x-api-key");
    });

    const provider = new AnthropicProvider({ id: "claude", apiKey: "bad-key", model: "claude-test" });

    const events = [];
    for await (const event of provider.chat({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error", message: "invalid x-api-key" }]);
  });

  it("reports capabilities and context window from config", () => {
    const provider = new AnthropicProvider({
      id: "claude",
      apiKey: "test-key",
      model: "claude-test",
      contextWindow: 200000,
    });

    expect(provider.supportsTools()).toBe(true);
    expect(provider.supportsVision()).toBe(true);
    expect(provider.getContextWindow()).toBe(200000);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd packages/providers/anthropic
npx vitest run src/AnthropicProvider.test.ts
```

Expected: FAIL — `Cannot find module './AnthropicProvider.js'`.

- [ ] **Step 6: Implement `AnthropicProvider.ts`**

```ts
// packages/providers/anthropic/src/AnthropicProvider.ts
import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, LlmEvent, LlmProvider, LlmRequest } from "@agenter/agent-core";

export interface AnthropicProviderConfig {
  id: string;
  apiKey: string;
  model: string;
  contextWindow?: number;
}

function splitSystemMessage(messages: ChatMessage[]): {
  system: string | undefined;
  rest: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemMessages = messages.filter((m) => m.role === "system");
  const rest = messages
    .filter((m): m is ChatMessage & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  return {
    system: systemMessages.length > 0 ? systemMessages.map((m) => m.content).join("\n\n") : undefined,
    rest,
  };
}

export class AnthropicProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly contextWindow: number;

  constructor(config: AnthropicProviderConfig) {
    this.id = config.id;
    this.model = config.model;
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.contextWindow = config.contextWindow ?? 200000;
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }

  getContextWindow(): number {
    return this.contextWindow;
  }

  async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
    const { system, rest } = splitSystemMessage(request.messages);

    let stream: AsyncIterable<Record<string, unknown>>;
    try {
      stream = this.client.messages.stream({
        model: this.model,
        max_tokens: 4096,
        system,
        messages: rest,
      }) as unknown as AsyncIterable<Record<string, unknown>>;
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
      return;
    }

    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    try {
      for await (const event of stream) {
        if (event.type === "message_start") {
          const usage = (event.message as { usage?: { input_tokens?: number } } | undefined)?.usage;
          promptTokens = usage?.input_tokens;
          continue;
        }

        if (event.type === "content_block_delta") {
          const delta = event.delta as { type?: string; text?: string };
          if (delta.type === "text_delta" && delta.text) {
            yield { type: "text.delta", text: delta.text };
          }
          continue;
        }

        if (event.type === "message_delta") {
          const usage = event.usage as { output_tokens?: number } | undefined;
          completionTokens = usage?.output_tokens;
          continue;
        }

        if (event.type === "message_stop") {
          yield {
            type: "done",
            usage:
              promptTokens !== undefined && completionTokens !== undefined
                ? { promptTokens, completionTokens }
                : undefined,
          };
        }
      }
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
}
```

- [ ] **Step 7: Run test again, confirm it passes**

```bash
npx vitest run src/AnthropicProvider.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 8: Create `packages/providers/anthropic/src/index.ts`**

```ts
export * from "./AnthropicProvider.js";
```

- [ ] **Step 9: Typecheck, lint, test the whole package**

```bash
cd ../../..
npm run typecheck --workspace=@agenter/provider-anthropic
npm run test --workspace=@agenter/provider-anthropic
npm run lint
```

Expected: no errors, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/providers/anthropic package.json package-lock.json
git commit -m "feat(provider-anthropic): add streaming Anthropic provider"
```

---

## Task 4: apps/api — YAML provider config with env-var interpolation

**Files:**
- Create: `config/providers.yaml`
- Modify: `.env.example`
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/src/config.test.ts` (new)
- Modify: `apps/api/package.json` (add `yaml` dependency)

**Interfaces:**
- Consumes: nothing new.
- Produces: `interface ProviderConfigEntry { id: string; type: "openai-compatible" | "anthropic"; baseUrl?: string; apiKey: string; model: string; contextWindow?: number }`, `interface AppConfig { port: number; dbPath: string; providers: ProviderConfigEntry[]; defaultProviderId: string }`, `loadConfig(): AppConfig`, and `interpolateEnv(value: string): string` (exported for the test). Task 6 (`providerFactory.ts`) consumes `AppConfig.providers` and `AppConfig.defaultProviderId`.

- [ ] **Step 1: Add the `yaml` dependency**

```bash
npm install yaml@2.9.1 --workspace=@agenter/api --save-exact
```

- [ ] **Step 2: Create `config/providers.yaml`**

```yaml
defaultProvider: local-fast

providers:
  local-fast:
    type: openai-compatible
    baseUrl: http://localhost:1234/v1
    apiKey: local
    model: qwen3-coder-30b

  claude:
    type: anthropic
    apiKey: ${ANTHROPIC_API_KEY}
    model: claude-sonnet-4-5
```

This mirrors PROMT.md §5's example structure (`providers:` map keyed by id, each with `type`/`baseUrl`/`apiKey`/`model`) plus a top-level `defaultProvider` key that the spec's snippet doesn't show but which Phase 2 needs (no router yet to pick one at request time).

- [ ] **Step 3: Update `.env.example`**

Replace the `PROVIDER_*` block:

```text
PORT=3000
DB_PATH=./data/agenter.db

ANTHROPIC_API_KEY=sk-ant-your-key-here
```

- [ ] **Step 4: Write the failing test for env interpolation and YAML loading**

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
    delete process.env.TEST_CLAUDE_KEY;
  });

  it("parses providers.yaml, resolves ${VAR} placeholders, and reports the default provider", () => {
    process.env.TEST_CLAUDE_KEY = "sk-resolved";
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
        "  claude:",
        "    type: anthropic",
        "    apiKey: ${TEST_CLAUDE_KEY}",
        "    model: claude-test",
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
        id: "claude",
        type: "anthropic",
        baseUrl: undefined,
        apiKey: "sk-resolved",
        model: "claude-test",
        contextWindow: undefined,
      },
    ]);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd apps/api
npx vitest run src/config.test.ts
```

Expected: FAIL — `interpolateEnv`/`loadConfigFromFile` are not exported yet.

- [ ] **Step 6: Rewrite `config.ts`**

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
  type: "openai-compatible" | "anthropic";
  baseUrl?: string;
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
    { type: "openai-compatible" | "anthropic"; baseUrl?: string; apiKey: string; model: string; contextWindow?: number }
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

- [ ] **Step 7: Run test again, confirm it passes**

```bash
npx vitest run src/config.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 8: Typecheck and lint**

```bash
cd ../..
npm install
npm run typecheck --workspace=@agenter/api
npm run lint
```

Expected: no errors. (`loadConfig()` itself isn't called by any test yet — it's exercised in Task 6's bootstrap.)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/config.test.ts apps/api/package.json config/providers.yaml .env.example package-lock.json
git commit -m "feat(api): load provider config from YAML with env-var interpolation"
```

---

## Task 5: apps/api — providerFactory builds a ProviderRegistry from config

**Files:**
- Create: `apps/api/src/providerFactory.ts`
- Test: `apps/api/src/providerFactory.test.ts`
- Modify: `apps/api/package.json` (add `@agenter/provider-anthropic` dependency)

**Interfaces:**
- Consumes: `ProviderConfigEntry`, `AppConfig` (Task 4); `ProviderRegistry` (`@agenter/agent-core`, Task 1); `OpenAICompatibleProvider` (`@agenter/provider-openai-compatible`, existing); `AnthropicProvider` (`@agenter/provider-anthropic`, Task 3).
- Produces: `function buildProviderRegistry(config: AppConfig): ProviderRegistry`. Task 6 (`apps/api/src/index.ts`) calls this once at startup.

This is the **only** file in the whole repo that imports both concrete provider classes — everything else (including `AgentRuntime`) sees only `LlmProvider`/`ProviderRegistry`.

- [ ] **Step 1: Add the `@agenter/provider-anthropic` dependency to `apps/api`**

```bash
npm install @agenter/provider-anthropic@0.1.0 --workspace=@agenter/api --save-exact
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/src/providerFactory.test.ts
import { describe, expect, it } from "vitest";
import { buildProviderRegistry } from "./providerFactory.js";
import type { AppConfig } from "./config.js";

describe("buildProviderRegistry", () => {
  it("registers an OpenAICompatibleProvider for a openai-compatible entry and an AnthropicProvider for an anthropic entry", () => {
    const config: AppConfig = {
      port: 3000,
      dbPath: ":memory:",
      defaultProviderId: "local-fast",
      providers: [
        {
          id: "local-fast",
          type: "openai-compatible",
          baseUrl: "http://localhost:1234/v1",
          apiKey: "local",
          model: "qwen3",
        },
        {
          id: "claude",
          type: "anthropic",
          apiKey: "sk-test",
          model: "claude-test",
        },
      ],
    };

    const registry = buildProviderRegistry(config);

    expect(registry.get("local-fast")?.model).toBe("qwen3");
    expect(registry.get("claude")?.model).toBe("claude-test");
    expect(registry.getDefaultId()).toBe("local-fast");
    expect(registry.list()).toHaveLength(2);
  });

  it("throws for an unknown provider type", () => {
    const config: AppConfig = {
      port: 3000,
      dbPath: ":memory:",
      defaultProviderId: "bad",
      providers: [{ id: "bad", type: "unsupported" as never, apiKey: "x", model: "x" }],
    };

    expect(() => buildProviderRegistry(config)).toThrow('Unknown provider type: "unsupported"');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/api
npx vitest run src/providerFactory.test.ts
```

Expected: FAIL — `Cannot find module './providerFactory.js'`.

- [ ] **Step 4: Implement `providerFactory.ts`**

```ts
// apps/api/src/providerFactory.ts
import { ProviderRegistry } from "@agenter/agent-core";
import { OpenAICompatibleProvider } from "@agenter/provider-openai-compatible";
import { AnthropicProvider } from "@agenter/provider-anthropic";
import type { AppConfig, ProviderConfigEntry } from "./config.js";

function buildProvider(entry: ProviderConfigEntry) {
  if (entry.type === "openai-compatible") {
    if (!entry.baseUrl) {
      throw new Error(`Provider "${entry.id}" is type openai-compatible but has no baseUrl`);
    }
    return new OpenAICompatibleProvider({
      id: entry.id,
      baseUrl: entry.baseUrl,
      apiKey: entry.apiKey,
      model: entry.model,
      contextWindow: entry.contextWindow,
    });
  }

  if (entry.type === "anthropic") {
    return new AnthropicProvider({
      id: entry.id,
      apiKey: entry.apiKey,
      model: entry.model,
      contextWindow: entry.contextWindow,
    });
  }

  throw new Error(`Unknown provider type: "${entry.type}"`);
}

export function buildProviderRegistry(config: AppConfig): ProviderRegistry {
  const registry = new ProviderRegistry(config.defaultProviderId);
  for (const entry of config.providers) {
    registry.register(buildProvider(entry));
  }
  return registry;
}
```

- [ ] **Step 5: Run test again, confirm it passes**

```bash
npx vitest run src/providerFactory.test.ts
```

Expected: both tests PASS.

- [ ] **Step 6: Typecheck, lint, test**

```bash
cd ../..
npm install
npm run typecheck --workspace=@agenter/api
npm run test --workspace=@agenter/api
npm run lint
```

Expected: no errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/providerFactory.ts apps/api/src/providerFactory.test.ts apps/api/package.json package-lock.json
git commit -m "feat(api): add providerFactory to build ProviderRegistry from config"
```

---

## Task 6: apps/api — wire ProviderRegistry through ChatService, routes, and bootstrap

**Files:**
- Modify: `apps/api/src/services/ChatService.ts`
- Modify: `apps/api/src/services/ChatService.test.ts`
- Modify: `apps/api/src/routes/providers.ts`
- Modify: `apps/api/src/routes/messages.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `AgentRuntime` (now registry-based, Task 2), `ProviderRegistry` (Task 1), `buildProviderRegistry` (Task 5), `loadConfig` (Task 4).
- Produces: `ChatService.sendMessage(chatId: string, content: string, providerId?: string): AsyncGenerator<AgentEvent>`; `GET /api/providers` returning `{ providers: Array<{ id: string; model: string }>, defaultProviderId: string }`; `POST /api/chats/:id/messages` accepting an optional `providerId` field in its JSON body. No later task in this plan depends on further changes here — this is the last task.

- [ ] **Step 1: Update the failing test for `ChatService.sendMessage`**

Add this test case to the existing `describe("ChatService", ...)` block in `apps/api/src/services/ChatService.test.ts` (keep the other four `it(...)` blocks unchanged):

```ts
  it("forwards an optional providerId through to AgentRuntime.runTurn", async () => {
    const events: AgentEvent[] = [{ type: "run.started", provider: "claude", model: "claude-test" }];
    const storage = fakeStorage();
    const runtime = fakeRuntime(events);
    const service = new ChatService(storage, runtime as never);

    const received: AgentEvent[] = [];
    for await (const event of service.sendMessage("c1", "hello", "claude")) {
      received.push(event);
    }

    expect(received).toEqual(events);
    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "hello", "claude");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run src/services/ChatService.test.ts
```

Expected: FAIL — `ChatService.sendMessage` doesn't accept a third argument yet, so `runtime.runTurn` is called with only `("c1", "hello")`, and the `toHaveBeenCalledWith` assertion including `"claude"` fails.

- [ ] **Step 3: Update `ChatService.ts`**

```ts
// apps/api/src/services/ChatService.ts
import type { AgentEvent, AgentRuntime, Chat, ChatStorage, StoredMessage } from "@agenter/agent-core";

export interface ChatWithMessages {
  chat: Chat;
  messages: StoredMessage[];
}

export class ChatService {
  constructor(
    private readonly storage: ChatStorage,
    private readonly runtime: AgentRuntime
  ) {}

  listChats(): Chat[] {
    return this.storage.listChats();
  }

  createChat(title = "New chat"): Chat {
    return this.storage.createChat(title);
  }

  getChatWithMessages(id: string): ChatWithMessages | undefined {
    const chat = this.storage.getChat(id);
    if (!chat) return undefined;

    return { chat, messages: this.storage.listMessages(id) };
  }

  deleteChat(id: string): void {
    this.storage.deleteChat(id);
  }

  async *sendMessage(chatId: string, content: string, providerId?: string): AsyncGenerator<AgentEvent> {
    yield* this.runtime.runTurn(chatId, content, providerId);
  }
}
```

- [ ] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/services/ChatService.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Update `routes/providers.ts`**

```ts
// apps/api/src/routes/providers.ts
import { Router } from "express";
import type { ProviderRegistry } from "@agenter/agent-core";

export function createProvidersRouter(registry: ProviderRegistry): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      providers: registry.list().map((provider) => ({ id: provider.id, model: provider.model })),
      defaultProviderId: registry.getDefaultId(),
    });
  });

  return router;
}
```

- [ ] **Step 6: Update `routes/messages.ts` to read an optional `providerId` from the request body**

```ts
// apps/api/src/routes/messages.ts
import { Router } from "express";
import type { ChatService } from "../services/ChatService.js";

export function createMessagesRouter(chatService: ChatService): Router {
  const router = Router();

  router.post("/:id/messages", async (req, res) => {
    const content = req.body?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content must be a non-empty string" });
      return;
    }

    const providerId = typeof req.body?.providerId === "string" ? req.body.providerId : undefined;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      for await (const event of chatService.sendMessage(req.params.id, content, providerId)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.write(`data: ${JSON.stringify({ type: "run.error", message })}\n\n`);
    } finally {
      res.end();
    }
  });

  return router;
}
```

- [ ] **Step 7: Update `apps/api/src/index.ts` to build the registry via `providerFactory`**

```ts
// apps/api/src/index.ts
import express from "express";
import { AgentRuntime } from "@agenter/agent-core";
import { SqliteChatStorage } from "@agenter/storage";
import { loadConfig } from "./config.js";
import { buildProviderRegistry } from "./providerFactory.js";
import { ChatService } from "./services/ChatService.js";
import { createChatsRouter } from "./routes/chats.js";
import { createProvidersRouter } from "./routes/providers.js";
import { createMessagesRouter } from "./routes/messages.js";

const config = loadConfig();

const storage = new SqliteChatStorage(config.dbPath);
const registry = buildProviderRegistry(config);
const runtime = new AgentRuntime(registry, storage);
const chatService = new ChatService(storage, runtime);

const app = express();
app.use(express.json());

app.use("/api/chats", createChatsRouter(chatService));
app.use("/api/chats", createMessagesRouter(chatService));
app.use("/api/providers", createProvidersRouter(registry));

app.listen(config.port, () => {
  console.log(`agenter api listening on http://localhost:${config.port}`);
});
```

- [ ] **Step 8: Typecheck, lint, test the whole workspace**

```bash
npm run typecheck
npm run test
npm run lint
```

Expected: no errors, all tests pass across every workspace.

- [ ] **Step 9: Manually verify the server boots with two configured providers**

Create `.env` from `.env.example` (set a real or dummy `ANTHROPIC_API_KEY` — a dummy key is fine if you only exercise the `local-fast` path). Then:

```bash
cd apps/api
node --experimental-strip-types --env-file=../../.env src/index.ts
```

In a second terminal:

```bash
curl -s http://localhost:3000/api/providers
```

Expected: `{"providers":[{"id":"local-fast","model":"qwen3-coder-30b"},{"id":"claude","model":"claude-sonnet-4-5"}],"defaultProviderId":"local-fast"}`.

If an OpenAI-compatible server is reachable at the configured `baseUrl`, also repeat Phase 1's chat-creation + message-sending curl sequence (create a chat, `POST` a message with no `providerId` in the body, confirm it streams from `local-fast`; then `POST` another message with `{"content":"...", "providerId":"claude"}` and confirm the `run.started` event reports `"provider":"claude"` — this second call will fail with an upstream auth error if `ANTHROPIC_API_KEY` is a dummy value, which is expected and fine; the point is confirming routing picked the right provider, not a live Anthropic response). If no such server is reachable, skip the live check and say so explicitly rather than claiming it was verified.

Stop the server (Ctrl+C) when done.

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): wire ProviderRegistry through ChatService, routes, and bootstrap"
```

---

## Self-review notes

- **Spec coverage:** §4 (provider interface + `AnthropicProvider`) — Task 3. §5 (`ProviderRegistry`, YAML config outside source, env var interpolation, no secrets in git) — Tasks 1, 4, 5. §6 (`ProviderRouter`, manual/auto, `TaskType`) — explicitly deferred to Phase 3; Task 2's optional `providerId` param is the seam it will plug into. Everything else in PROMT.md (Skills, MCP, ToolRegistry, tool loop, frontend selectors) is out of scope for Phase 2 per the phase-by-phase plan structure agreed with the user.
- **Placeholder scan:** no TBD/TODO; every step has runnable code and concrete expected output.
- **Type consistency:** `ProviderConfigEntry`/`AppConfig` (Task 4) match the fields `providerFactory.ts` (Task 5) and its test destructure; `ProviderRegistry`'s method names (`register`, `get`, `list`, `getDefaultId`, `getDefault`) are used identically in `AgentRuntime.ts` (Task 2), `providerFactory.ts` (Task 5), and `routes/providers.ts` (Task 6). `AgentRuntime.runTurn`'s third parameter is named `providerId` everywhere it's threaded through (`ChatService.sendMessage`, `routes/messages.ts` body field, `AgentRuntime.test.ts`).
