# Phase 3: Provider Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ProviderRouter` that picks which configured provider handles a request when the caller doesn't name one, choosing between an explicit manual `providerId` (unchanged passthrough) and a rule-based `auto` mode that classifies the request into a `TaskType` and maps it to a provider via `config/routing.yaml`.

**Architecture:** `ProviderRouter` (new, in `packages/agent-core`) is pure classification logic: given a `RoutingContext` describing signals about the current request, it returns a `TaskType`, then looks up the configured provider id for that type in a `RoutingConfig` map it was constructed with. It never reads files or env vars — `apps/api` loads `config/routing.yaml` into a `RoutingConfig` (extending `AppConfig`, mirroring how `config/providers.yaml` already feeds `ProviderRegistry`) and hands it to `new ProviderRouter(config.routing)` at bootstrap. `AgentRuntime.runTurn` gains a `RunTurnOptions` parameter (`{ providerId?, mode?, routingContext? }`) replacing the bare `providerId` argument: when `providerId` is given it skips the router entirely (today's manual behavior, unchanged); when `mode` is `"auto"` and no `providerId` is given, it asks the injected `ProviderRouter` to classify `routingContext` and resolve a provider id; otherwise it falls back to the registry's configured default, exactly as before. `RoutingContext` is a plain data bag (`hasImageAttachment?`, `activeSkill?`, `toolsRequired?`) that Phase 3 populates with nothing but its own defaults (no skills, no MCP, no images yet exist) — later phases (Phase 4 skills, Phase 6 MCP, Phase 8 image upload) fill in real values without `ProviderRouter`'s constructor or method signatures changing, satisfying PROMT.md §6's requirement that a rule-based router be swappable for an LLM classifier later (the same `classify`/`resolveProviderId` contract, just a different implementation behind it). `apps/api` threads `RunTurnOptions` from the `POST /messages` request body through `ChatService.sendMessage` down to `AgentRuntime.runTurn`.

**Tech Stack:** Same as Phase 1/2 (Node.js with `node:sqlite`, TypeScript strict, Express, Vitest, npm workspaces, `yaml` for config parsing). No new dependencies.

**Spec:** `PROMT.md` §3 (`ProviderRouter` listed as a core backend component), §6 (`ProviderRouter`: manual vs. auto mode, `TaskType` union, rule-based classification example, `routing.yaml` outside source, "architecture must allow later replacing rule-based router with LLM classifier"). §7 (Skills) and §8 (MCP) — the real sources of `coding skill active` / `MCP/tools required` signals — are explicitly out of scope; this plan only defines the `RoutingContext` shape they will populate.

## Global Constraints

- Node.js >=24.0.0, using built-in `node:sqlite` — unchanged from Phase 1/2.
- TypeScript strict mode (`tsconfig.base.json`, includes `noUncheckedIndexedAccess: true`) — every new/modified package extends it unchanged.
- No new dependencies needed for this phase; if any were, they'd be pinned exact via `npm install <pkg> --save-exact` per existing convention.
- `AgentRuntime` and all of `packages/agent-core` stay provider-agnostic and config-agnostic — `ProviderRouter` takes a plain `RoutingConfig` object, never reads `routing.yaml` itself (PROMT.md §6: "Конфигурация routing также должна находиться вне исходного кода" — the file I/O lives in `apps/api`, same split as `ProviderRegistry`/`providerFactory.ts`).
- Vitest for all tests, mirroring each package's existing `test` script (`vitest run`).
- Every package's `tsconfig.json` extends `tsconfig.base.json` and every `package.json` follows the existing shape (`private: true`, `type: module`, `main`/`types` → `./src/index.ts`, `typecheck`/`test` scripts).
- No `AnthropicProvider`, no frontend changes (`apps/web` is Phase 8), no Skills/MCP/tool-loop implementation (Phases 4/6/7) — this plan only shapes the `RoutingContext` interface those phases will populate.

## Decisions worth flagging

- **`RoutingContext` is a data bag with every field optional, populated by nothing in this phase.** PROMT.md §6's rule list needs "coding skill active" (Phase 4) and "MCP/tools required" (Phase 6/7) signals that don't exist yet. Rather than stub out a fake `SkillRegistry`/`ToolRegistry` call, `RoutingContext` just declares `{ hasImageAttachment?: boolean; activeSkill?: string; toolsRequired?: boolean }` and `ProviderRouter.classify()` checks each field defensively (`context.hasImageAttachment === true`, etc.), falling through to `"simple"` when nothing is set. Phase 4 adds a real `activeSkill` value at the call site in `apps/api`; Phase 6/7 add a real `toolsRequired` value the same way. `ProviderRouter`'s own code never changes for that — only its caller's `RoutingContext` construction does.
- **Rule order matches the spec's list exactly** (image → vision, skill → coding, tools → reasoning, else → simple) and is a plain `if`/`else if` chain in `classify()`, not a data-driven rule table. A rule table would be premature abstraction for four conditions; "replace with an LLM classifier later" (the spec's stated future direction) means swapping the whole `ProviderRouter` class for one with the same two public methods, not extending this table — so simplicity now doesn't box in that future.
- **`research` is a reachable `TaskType` in the union and in `routing.yaml`, but no rule in Phase 3 ever returns it.** The spec lists `research` as a task type with its own `routing.yaml` entry, but none of its three example rules (image/skill/tools) produce it — it's presumably chosen by a future skill (e.g. a "research" skill) or the later LLM classifier. Keeping it in the type union and config now avoids a breaking change to both when that trigger is added.
- **`AgentRuntime.runTurn`'s third parameter changes from `providerId?: string` to a single `options?: RunTurnOptions` object** (`{ providerId?: string; mode?: "manual" | "auto"; routingContext?: RoutingContext }`) rather than adding more positional parameters. Three optional values that are meaningfully independent (an explicit id, a mode flag, and a context bag) are clearer as one options object than `runTurn(chatId, msg, providerId?, mode?, routingContext?)`, and it's the last signature change this method needs for auto-routing — Phase 4/6 extend `RoutingContext`'s fields, not this parameter list. This is a breaking change to `runTurn`'s signature; Task 4 updates the one caller (`ChatService.sendMessage`) in the same phase.
- **When `providerId` is omitted and `mode` is omitted or `"manual"`, behavior is unchanged from Phase 2**: `AgentRuntime` falls back to `registry.getDefault()`. Auto-routing only activates when the caller explicitly asks for `mode: "auto"` — a client that never sends `mode` sees no behavior change after this phase ships.
- **`ProviderRouter.resolveProviderId()` returns the routed provider *id*, not a resolved `LlmProvider`** — `AgentRuntime` still does the actual `registry.get(id)` lookup and still emits the same `run.error` for an unknown id (now possibly unknown because `routing.yaml` names a provider that was removed from `providers.yaml`, not just because of a bad manual `providerId`). This keeps `ProviderRouter` free of any dependency on `ProviderRegistry`, so `packages/agent-core`'s two new-in-Phase-3 pieces (`ProviderRouter`, its config types) stay decoupled from Phase 2's registry — `AgentRuntime` is the only place that wires them together.
- **`routing.yaml` is a flat `routes: Record<TaskType, { provider: string }>` map, loaded by a new `loadRoutingConfigFromFile`/extended `loadConfig` in `apps/api/src/config.ts`**, following the exact pattern `loadConfigFromFile`/`interpolateEnv` already established for `providers.yaml` in Phase 2. No env-var interpolation is needed here (provider ids aren't secrets), so `loadRoutingConfigFromFile` is a plain YAML parse with a runtime shape check, not a copy of `interpolateEnv`.
- **A `routing.yaml` entry naming a provider id that isn't registered is *not* validated at startup in this phase.** `providerFactory.ts`'s Phase 2 pattern (calling `registry.getDefault()` once to fail fast) works because there's exactly one default id to check; validating every one of five route entries against the registry would require `apps/api`'s bootstrap to cross-reference two independently-loaded configs before constructing anything. Given routing misconfiguration surfaces immediately as a `run.error` on the very next request (same as an unknown manual `providerId` today), deferring that validation is a reasonable scope cut for this phase, not a silent failure mode.

## File Structure

```text
agenter/
├── config/
│   └── routing.yaml                        NEW — TaskType → provider id map
│
├── packages/
│   └── agent-core/
│       └── src/
│           ├── ProviderRouter.ts           NEW — TaskType, RoutingContext, RoutingConfig, ProviderRouter
│           ├── ProviderRouter.test.ts      NEW
│           ├── AgentRuntime.ts             MODIFIED — runTurn(chatId, userMessage, options?: RunTurnOptions)
│           ├── AgentRuntime.test.ts        MODIFIED
│           └── index.ts                    MODIFIED — export ProviderRouter and its types
│
└── apps/
    └── api/
        └── src/
            ├── config.ts                   MODIFIED — AppConfig.routing, loadRoutingConfigFromFile
            ├── config.test.ts              MODIFIED — tests for routing config loading
            ├── services/ChatService.ts     MODIFIED — sendMessage(chatId, content, options?: SendMessageOptions)
            ├── services/ChatService.test.ts MODIFIED
            ├── routes/messages.ts          MODIFIED — reads mode/routingContext from body alongside providerId
            └── index.ts                    MODIFIED — constructs ProviderRouter from config.routing, passes to AgentRuntime
```

---

## Task 1: agent-core — TaskType, RoutingContext, RoutingConfig, ProviderRouter

**Files:**
- Create: `packages/agent-core/src/ProviderRouter.ts`
- Test: `packages/agent-core/src/ProviderRouter.test.ts`
- Modify: `packages/agent-core/src/index.ts`

**Interfaces:**
- Consumes: nothing new (pure logic, no dependency on `ProviderRegistry` or `types.ts`).
- Produces: `type TaskType = "simple" | "coding" | "reasoning" | "research" | "vision"`; `const ALL_TASK_TYPES: readonly TaskType[]` (every `TaskType` value, once, for config validation); `interface RoutingContext { hasImageAttachment?: boolean; activeSkill?: string; toolsRequired?: boolean }`; `type RoutingConfig = Record<TaskType, { provider: string }>`; `class ProviderRouter` with constructor `(config: RoutingConfig)`, methods `classify(context: RoutingContext): TaskType` and `resolveProviderId(context: RoutingContext): string`. Task 2 (`apps/api/config.ts`) consumes `ALL_TASK_TYPES` to validate `routing.yaml`; Task 3 (`AgentRuntime`) consumes `ProviderRouter.resolveProviderId`; Task 2 also produces the `RoutingConfig` shape this class is constructed with (via `AppConfig.routing`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-core/src/ProviderRouter.test.ts
import { describe, expect, it } from "vitest";
import { ALL_TASK_TYPES, ProviderRouter } from "./ProviderRouter.js";
import type { RoutingConfig } from "./ProviderRouter.js";

const config: RoutingConfig = {
  simple: { provider: "local-fast" },
  coding: { provider: "local-code" },
  reasoning: { provider: "local-fast" },
  research: { provider: "local-fast" },
  vision: { provider: "local-fast" },
};

describe("ProviderRouter.classify", () => {
  it("classifies as vision when an image is attached", () => {
    const router = new ProviderRouter(config);
    expect(router.classify({ hasImageAttachment: true })).toBe("vision");
  });

  it("classifies as coding when a skill is active", () => {
    const router = new ProviderRouter(config);
    expect(router.classify({ activeSkill: "code-review" })).toBe("coding");
  });

  it("classifies as reasoning when tools are required", () => {
    const router = new ProviderRouter(config);
    expect(router.classify({ toolsRequired: true })).toBe("reasoning");
  });

  it("classifies as simple when no signal is present", () => {
    const router = new ProviderRouter(config);
    expect(router.classify({})).toBe("simple");
  });

  it("classifies as simple when context fields are explicitly false/undefined", () => {
    const router = new ProviderRouter(config);
    expect(
      router.classify({ hasImageAttachment: false, activeSkill: undefined, toolsRequired: false })
    ).toBe("simple");
  });

  it("checks image before skill before tools, in that priority order", () => {
    const router = new ProviderRouter(config);
    expect(
      router.classify({ hasImageAttachment: true, activeSkill: "code-review", toolsRequired: true })
    ).toBe("vision");
    expect(router.classify({ activeSkill: "code-review", toolsRequired: true })).toBe("coding");
  });
});

describe("ALL_TASK_TYPES", () => {
  it("lists every TaskType exactly once, for config validation elsewhere", () => {
    expect(ALL_TASK_TYPES).toEqual(["simple", "coding", "reasoning", "research", "vision"]);
  });
});

describe("ProviderRouter.resolveProviderId", () => {
  it("resolves the configured provider id for the classified task type", () => {
    const router = new ProviderRouter(config);
    expect(router.resolveProviderId({ activeSkill: "code-review" })).toBe("local-code");
    expect(router.resolveProviderId({})).toBe("local-fast");
  });

  it("resolves distinct providers per task type when configured differently", () => {
    const distinctConfig: RoutingConfig = {
      simple: { provider: "local-fast" },
      coding: { provider: "local-code" },
      reasoning: { provider: "local-reasoning" },
      research: { provider: "local-research" },
      vision: { provider: "local-vision" },
    };
    const router = new ProviderRouter(distinctConfig);
    expect(router.resolveProviderId({ toolsRequired: true })).toBe("local-reasoning");
    expect(router.resolveProviderId({ hasImageAttachment: true })).toBe("local-vision");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agent-core
npx vitest run src/ProviderRouter.test.ts
```

Expected: FAIL — `Cannot find module './ProviderRouter.js'`.

- [ ] **Step 3: Implement `ProviderRouter.ts`**

```ts
// packages/agent-core/src/ProviderRouter.ts
export type TaskType = "simple" | "coding" | "reasoning" | "research" | "vision";

export const ALL_TASK_TYPES: readonly TaskType[] = ["simple", "coding", "reasoning", "research", "vision"];

export interface RoutingContext {
  hasImageAttachment?: boolean;
  activeSkill?: string;
  toolsRequired?: boolean;
}

export type RoutingConfig = Record<TaskType, { provider: string }>;

export class ProviderRouter {
  constructor(private readonly config: RoutingConfig) {}

  classify(context: RoutingContext): TaskType {
    if (context.hasImageAttachment === true) return "vision";
    if (context.activeSkill) return "coding";
    if (context.toolsRequired === true) return "reasoning";
    return "simple";
  }

  resolveProviderId(context: RoutingContext): string {
    const taskType = this.classify(context);
    return this.config[taskType].provider;
  }
}
```

Rule order mirrors PROMT.md §6's list verbatim (image → vision, skill → coding, tools → reasoning, else → simple). `activeSkill` is treated as "active" whenever it's a non-empty string — Phase 4's `SkillRegistry` is expected to pass the active skill's name here, or omit the field entirely when no skill matched.

- [ ] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/ProviderRouter.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Export it from the barrel**

```ts
// packages/agent-core/src/index.ts
export * from "./types.js";
export * from "./ContextBuilder.js";
export * from "./ProviderRouter.js";
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
git commit -m "feat(agent-core): add ProviderRouter with rule-based auto classification"
```

---

## Task 2: apps/api — load routing.yaml into AppConfig

**Files:**
- Create: `config/routing.yaml`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`

**Interfaces:**
- Consumes: `TaskType`, `ALL_TASK_TYPES`, `RoutingConfig` from `@agenter/agent-core` (Task 1).
- Produces: extends `AppConfig` with `routing: RoutingConfig`; adds `loadRoutingConfigFromFile(path: string): RoutingConfig` (exported for the test, same pattern as `loadConfigFromFile`). Task 4 (`apps/api/src/index.ts`) consumes `AppConfig.routing` to construct a `ProviderRouter`.

- [ ] **Step 1: Create `config/routing.yaml`**

```yaml
routes:
  simple:
    provider: local-fast
  coding:
    provider: local-code
  reasoning:
    provider: local-fast
  research:
    provider: local-fast
  vision:
    provider: local-fast
```

This matches PROMT.md §6's shape (a `routes:` map keyed by `TaskType`) with provider ids that exist in this repo's `config/providers.yaml` (`local-fast`/`local-code`) rather than the spec's own example, which names `claude` — out of scope per the "no AnthropicProvider" decision from Phase 2.

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/src/config.test.ts — add alongside the existing describe blocks
import { loadRoutingConfigFromFile } from "./config.js";

describe("loadRoutingConfigFromFile", () => {
  const filePath = "./.tmp-test-routing.yaml";

  afterEach(() => {
    unlinkSync(filePath);
  });

  it("parses routing.yaml into a RoutingConfig keyed by TaskType", () => {
    writeFileSync(
      filePath,
      [
        "routes:",
        "  simple:",
        "    provider: local-fast",
        "  coding:",
        "    provider: local-code",
        "  reasoning:",
        "    provider: local-fast",
        "  research:",
        "    provider: local-fast",
        "  vision:",
        "    provider: local-fast",
        "",
      ].join("\n")
    );

    const routing = loadRoutingConfigFromFile(filePath);

    expect(routing).toEqual({
      simple: { provider: "local-fast" },
      coding: { provider: "local-code" },
      reasoning: { provider: "local-fast" },
      research: { provider: "local-fast" },
      vision: { provider: "local-fast" },
    });
  });

  it("throws when a TaskType is missing from routes", () => {
    writeFileSync(
      filePath,
      ["routes:", "  simple:", "    provider: local-fast", ""].join("\n")
    );

    expect(() => loadRoutingConfigFromFile(filePath)).toThrow(
      'routing.yaml is missing a route for task type "coding"'
    );
  });
});
```

Add the `describe("loadRoutingConfigFromFile", ...)` block to the existing `apps/api/src/config.test.ts` (it already imports `writeFileSync`/`unlinkSync`/`afterEach`/`describe`/`expect`/`it` from Phase 2 — just extend the existing import from `./config.js` to also bring in `loadRoutingConfigFromFile`).

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/api
npx vitest run src/config.test.ts
```

Expected: FAIL — `loadRoutingConfigFromFile` is not exported yet.

- [ ] **Step 4: Extend `config.ts`**

```ts
// apps/api/src/config.ts — add these imports alongside the existing ones
import { ALL_TASK_TYPES } from "@agenter/agent-core";
import type { RoutingConfig } from "@agenter/agent-core";
```

```ts
// apps/api/src/config.ts — extend AppConfig
export interface AppConfig {
  port: number;
  dbPath: string;
  providers: ProviderConfigEntry[];
  defaultProviderId: string;
  routing: RoutingConfig;
}
```

```ts
// apps/api/src/config.ts — new function, alongside loadConfigFromFile
interface RawRoutingYaml {
  routes: Record<string, { provider: string }>;
}

export function loadRoutingConfigFromFile(routingYamlPath: string): RoutingConfig {
  const raw = parseYaml(readFileSync(routingYamlPath, "utf-8")) as RawRoutingYaml;

  for (const taskType of ALL_TASK_TYPES) {
    if (!raw.routes[taskType]) {
      throw new Error(`routing.yaml is missing a route for task type "${taskType}"`);
    }
  }

  return raw.routes as RoutingConfig;
}
```

```ts
// apps/api/src/config.ts — extend loadConfig
export function loadConfig(): AppConfig {
  const providersYamlPath = path.resolve(__dirname, "../../../config/providers.yaml");
  const routingYamlPath = path.resolve(__dirname, "../../../config/routing.yaml");
  const { providers, defaultProviderId } = loadConfigFromFile(providersYamlPath);
  const routing = loadRoutingConfigFromFile(routingYamlPath);

  return {
    port: Number(process.env.PORT ?? "3000"),
    dbPath: process.env.DB_PATH ?? "./data/agenter.db",
    providers,
    defaultProviderId,
    routing,
  };
}
```

- [ ] **Step 5: Run test again, confirm it passes**

```bash
npx vitest run src/config.test.ts
```

Expected: all tests PASS (the 5 pre-existing Phase 2 tests plus the 2 new ones).

- [ ] **Step 6: Typecheck and lint**

```bash
cd ../..
npm run typecheck --workspace=@agenter/api
npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/config.test.ts config/routing.yaml
git commit -m "feat(api): load routing config from routing.yaml"
```

---

## Task 3: agent-core — wire ProviderRouter into AgentRuntime.runTurn

**Files:**
- Modify: `packages/agent-core/src/AgentRuntime.ts`
- Modify: `packages/agent-core/src/AgentRuntime.test.ts`

**Interfaces:**
- Consumes: `ProviderRouter` (Task 1), `RoutingContext` (Task 1), `ProviderRegistry` (Phase 2, unchanged).
- Produces: `class AgentRuntime` with constructor `(registry: ProviderRegistry, storage: ChatStorage, router: ProviderRouter, systemPrompt?: string)` and `runTurn(chatId: string, userMessage: string, options?: RunTurnOptions): AsyncGenerator<AgentEvent>`, where `interface RunTurnOptions { providerId?: string; mode?: "manual" | "auto"; routingContext?: RoutingContext }` (exported from `AgentRuntime.ts`). Task 4 (`apps/api`) consumes this constructor and `runTurn` signature — `ChatService.sendMessage` forwards its own `SendMessageOptions` straight through as `RunTurnOptions`.

- [ ] **Step 1: Replace the contents of `AgentRuntime.test.ts`**

```ts
// packages/agent-core/src/AgentRuntime.test.ts
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./AgentRuntime.js";
import { ProviderRegistry } from "./ProviderRegistry.js";
import { ProviderRouter } from "./ProviderRouter.js";
import type { RoutingConfig } from "./ProviderRouter.js";
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

const routingConfig: RoutingConfig = {
  simple: { provider: "fake" },
  coding: { provider: "coder" },
  reasoning: { provider: "fake" },
  research: { provider: "fake" },
  vision: { provider: "fake" },
};

describe("AgentRuntime.runTurn", () => {
  it("uses the registry's default provider when no options are given", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "done", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

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
    expect(storage.addRun).toHaveBeenCalledOnce();
  });

  it("uses the named provider when providerId is given, ignoring mode", async () => {
    const storage = fakeStorage();
    const defaultProvider = fakeProvider("default-one", "default-model", []);
    const namedProvider = fakeProvider("other", "other-model", [
      { type: "text.delta", text: "Hi" },
      { type: "done" },
    ]);
    const registry = registryWith([defaultProvider, namedProvider], "default-one");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { providerId: "other", mode: "auto" })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "run.started", provider: "other", model: "other-model" });
  });

  it("routes via ProviderRouter when mode is auto and no providerId is given", async () => {
    const storage = fakeStorage();
    const fast = fakeProvider("fake", "fake-model", []);
    const coder = fakeProvider("coder", "coder-model", [
      { type: "text.delta", text: "code" },
      { type: "done" },
    ]);
    const registry = registryWith([fast, coder], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", {
      mode: "auto",
      routingContext: { activeSkill: "code-review" },
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "run.started", provider: "coder", model: "coder-model" });
  });

  it("falls back to the registry default when mode is auto but routingContext is omitted", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [{ type: "done" }]);
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { mode: "auto" })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "run.started", provider: "fake", model: "fake-model" });
  });

  it("uses the registry default when mode is manual (or omitted) and no providerId is given", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [{ type: "done" }]);
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { mode: "manual" })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "run.started", provider: "fake", model: "fake-model" });
  });

  it("emits run.error and persists no assistant message when providerId is unknown", async () => {
    const storage = fakeStorage();
    const registry = registryWith([fakeProvider("fake", "fake-model", [])], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { providerId: "unknown-provider" })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.error", message: 'Unknown provider "unknown-provider"' },
    ]);
    expect(storage.addMessage).toHaveBeenCalledOnce();
    expect(storage.addRun).not.toHaveBeenCalled();
  });

  it("emits run.error and does not persist an assistant message when the provider errors", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [{ type: "error", message: "upstream down" }]);
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.started", provider: "fake", model: "fake-model" },
      { type: "run.error", message: "upstream down" },
    ]);
    expect(storage.addMessage).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agent-core
npx vitest run src/AgentRuntime.test.ts
```

Expected: FAIL — `AgentRuntime`'s constructor still takes `(registry, storage, systemPrompt?)` (no `router` parameter) and `runTurn`'s third parameter is still `providerId?: string`, not an options object.

- [ ] **Step 3: Update `AgentRuntime.ts`**

```ts
// packages/agent-core/src/AgentRuntime.ts
import { buildContext } from "./ContextBuilder.js";
import type { ProviderRegistry } from "./ProviderRegistry.js";
import type { ProviderRouter, RoutingContext } from "./ProviderRouter.js";
import type { AgentEvent, ChatStorage } from "./types.js";

export interface RunTurnOptions {
  providerId?: string;
  mode?: "manual" | "auto";
  routingContext?: RoutingContext;
}

export class AgentRuntime {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly storage: ChatStorage,
    private readonly router: ProviderRouter,
    private readonly systemPrompt: string = "You are a helpful assistant."
  ) {}

  async *runTurn(chatId: string, userMessage: string, options: RunTurnOptions = {}): AsyncGenerator<AgentEvent> {
    const history = this.storage.listMessages(chatId);
    const storedUserMessage = this.storage.addMessage({ chatId, role: "user", content: userMessage });

    const providerId = this.resolveProviderId(options);
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

  private resolveProviderId(options: RunTurnOptions): string | undefined {
    if (options.providerId) return options.providerId;
    if (options.mode === "auto") return this.router.resolveProviderId(options.routingContext ?? {});
    return undefined;
  }
}
```

`resolveProviderId` returning `undefined` means "use the registry default" — the same fallback Phase 2 had for a bare omitted `providerId`, now reached both when no options are passed at all and when `mode` is `"manual"`/omitted.

- [ ] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/AgentRuntime.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Export `RunTurnOptions` from the barrel**

```ts
// packages/agent-core/src/index.ts
export * from "./types.js";
export * from "./ContextBuilder.js";
export * from "./ProviderRouter.js";
export * from "./AgentRuntime.js";
```

(`AgentRuntime.js` now also exports `RunTurnOptions`, already covered by the existing `export *`.)

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
git commit -m "feat(agent-core): AgentRuntime routes via ProviderRouter in auto mode"
```

---

## Task 4: apps/api — wire RoutingContext through ChatService, the messages route, and bootstrap

**Files:**
- Modify: `apps/api/src/services/ChatService.ts`
- Modify: `apps/api/src/services/ChatService.test.ts`
- Modify: `apps/api/src/routes/messages.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `AgentRuntime` with the new `(registry, storage, router, systemPrompt?)` constructor and `runTurn(chatId, userMessage, options?: RunTurnOptions)` signature (Task 3), `ProviderRouter` (Task 1), `AppConfig.routing` (Task 2).
- Produces: `ChatService.sendMessage(chatId: string, content: string, options?: SendMessageOptions): AsyncGenerator<AgentEvent>` where `interface SendMessageOptions { providerId?: string; mode?: "manual" | "auto"; routingContext?: RoutingContext }` (re-exported from `ChatService.ts`, structurally identical to `RunTurnOptions` — kept as its own named type so `apps/api` doesn't leak `agent-core`'s exact type name into its own public service surface); consumed by `routes/messages.ts`.

- [ ] **Step 1: Update `ChatService.test.ts`'s existing `sendMessage` test and add a new one for options passthrough**

```ts
// apps/api/src/services/ChatService.test.ts — replace the last test in the file
it("delegates sendMessage to AgentRuntime.runTurn and forwards its events", async () => {
  const events: AgentEvent[] = [
    { type: "run.started", provider: "p", model: "m" },
    { type: "text.delta", text: "hi" },
    { type: "run.completed" },
  ];
  const storage = fakeStorage();
  const runtime = fakeRuntime(events);
  const service = new ChatService(storage, runtime as never);

  const received: AgentEvent[] = [];
  for await (const event of service.sendMessage("c1", "hello")) {
    received.push(event);
  }

  expect(received).toEqual(events);
  expect(runtime.runTurn).toHaveBeenCalledWith("c1", "hello", undefined);
});

it("forwards providerId, mode, and routingContext options to AgentRuntime.runTurn", async () => {
  const storage = fakeStorage();
  const runtime = fakeRuntime([]);
  const service = new ChatService(storage, runtime as never);

  const options = { mode: "auto" as const, routingContext: { activeSkill: "code-review" } };
  const received: AgentEvent[] = [];
  for await (const event of service.sendMessage("c1", "hello", options)) {
    received.push(event);
  }

  expect(runtime.runTurn).toHaveBeenCalledWith("c1", "hello", options);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run src/services/ChatService.test.ts
```

Expected: FAIL — `sendMessage` doesn't accept a third argument yet, so `runTurn` is called with only two.

- [ ] **Step 3: Update `ChatService.ts`**

```ts
// apps/api/src/services/ChatService.ts
import type { AgentEvent, AgentRuntime, Chat, ChatStorage, RoutingContext, StoredMessage } from "@agenter/agent-core";

export interface ChatWithMessages {
  chat: Chat;
  messages: StoredMessage[];
}

export interface SendMessageOptions {
  providerId?: string;
  mode?: "manual" | "auto";
  routingContext?: RoutingContext;
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

  async *sendMessage(chatId: string, content: string, options?: SendMessageOptions): AsyncGenerator<AgentEvent> {
    yield* this.runtime.runTurn(chatId, content, options);
  }
}
```

- [ ] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/services/ChatService.test.ts
```

Expected: all tests PASS (the 4 pre-existing chat-management tests, unaffected, plus the 2 updated/new `sendMessage` tests).

- [ ] **Step 5: Update `routes/messages.ts` to read `mode`/`providerId` from the request body**

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
    const mode = req.body?.mode === "auto" ? "auto" : req.body?.mode === "manual" ? "manual" : undefined;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      for await (const event of chatService.sendMessage(req.params.id, content, { providerId, mode })) {
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

`routingContext` is intentionally not read from the request body in this phase — there is no client-observable signal yet (no image upload, no skill selector) for it to carry. A caller can still exercise `mode: "auto"` today; without a populated `routingContext`, `ProviderRouter.classify` falls through every rule to `"simple"`, which is the correct, honest behavior for a phase with no skills/tools/vision wired up yet. Phase 4/6/8 extend this route to also read whatever new field lets the client signal `activeSkill`/`toolsRequired`/`hasImageAttachment`.

- [ ] **Step 6: Update `apps/api/src/index.ts` bootstrap**

```ts
// apps/api/src/index.ts
import express from "express";
import { AgentRuntime, ProviderRouter } from "@agenter/agent-core";
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
const router = new ProviderRouter(config.routing);
const runtime = new AgentRuntime(registry, storage, router);
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

This assumes Phase 2's `providerFactory.ts`/`buildProviderRegistry` and registry-backed `createProvidersRouter(registry)` are already in place exactly as that phase's plan left them (`docs/superpowers/plans/2026-09-16-phase2-provider-registry.md`, Task 4/5) — if Phase 2 hasn't shipped yet, complete it first; this task only adds the `ProviderRouter` construction and threads it into `AgentRuntime`'s new third constructor argument.

- [ ] **Step 7: Manual verification**

Start the API against `config/providers.yaml` and `config/routing.yaml` (adjust `baseUrl`/model values to whatever's actually running locally):

```bash
npm run dev --workspace=@agenter/api
```

In another terminal, create a chat and send one message with `mode: "auto"` and no `providerId`:

```bash
CHAT_ID=$(curl -s -X POST http://localhost:3000/api/chats -H 'Content-Type: application/json' -d '{"title":"test"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')

curl -N -X POST "http://localhost:3000/api/chats/$CHAT_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"hi","mode":"auto"}'
```

Expected: streams `run.started` with `provider: "local-fast"` (the `simple` route in `config/routing.yaml`) since no routing signal is present, followed by `text.delta` events and `run.completed`. Send a second request with an explicit `providerId` to confirm manual mode still bypasses the router:

```bash
curl -N -X POST "http://localhost:3000/api/chats/$CHAT_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"hi again","providerId":"local-code"}'
```

Expected: streams `run.started` with `provider: "local-code"`. Stop the dev server (`Ctrl+C`) once confirmed.

- [ ] **Step 8: Typecheck, lint, full workspace test**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: no errors, all tests across the workspace PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/ChatService.ts apps/api/src/services/ChatService.test.ts apps/api/src/routes/messages.ts apps/api/src/index.ts
git commit -m "feat(api): wire ProviderRouter through ChatService, messages route, and bootstrap"
```

---

## Self-review

**Spec coverage:** PROMT.md §3 lists `ProviderRouter` as a core backend component alongside `ProviderRegistry` — added in `packages/agent-core` in Task 1, matching where `ProviderRegistry` already lives (Phase 2). §6's two modes are both covered: manual (`providerId` given → router skipped entirely, Task 3 Step 3's `resolveProviderId` returns `options.providerId` first, unchanged from Phase 2's behavior) and auto (`mode: "auto"` + no `providerId` → `ProviderRouter.resolveProviderId(routingContext)`, Task 1 + Task 3). The `TaskType` union (`simple | coding | reasoning | research | vision`) is defined verbatim in Task 1. The rule-based classification example (image → vision, skill → coding, tools → reasoning, else → simple) is implemented as the exact same priority chain in `ProviderRouter.classify` (Task 1 Step 3) and covered by the priority-ordering test in Task 1 Step 1. "Конфигурация routing также должна находиться вне исходного кода" is covered by `config/routing.yaml` (Task 2 Step 1) loaded via `loadRoutingConfigFromFile`, mirroring the `providers.yaml`/`loadConfigFromFile` split from Phase 2 — `ProviderRouter` itself never touches the filesystem (Global Constraints, Decisions). "Архитектура должна позволять позже заменить rule-based router на LLM classifier" is addressed by keeping `ProviderRouter`'s public surface to exactly two methods (`classify`, `resolveProviderId`) with no rule-table internals leaking into `AgentRuntime` or `apps/api` — a future classifier-backed implementation swaps in behind the same two methods, and every caller (`AgentRuntime`, Task 3) only ever calls `resolveProviderId`, never inspects how classification happened (Decisions section, bullet 2). §7 (Skills) and §8 (MCP) are explicitly out of scope; `RoutingContext`'s `activeSkill`/`toolsRequired` fields are the seams those phases will populate, called out in the Architecture section and Decisions bullet 1 — no task in this plan implements skill or tool detection.

**Placeholder scan:** searched for "TBD", "TODO", "for now", "handle appropriately", "similar to Task N" — none present. Every code step has runnable TypeScript/YAML/bash, not descriptions of code. The one place that references another document (Task 4 Step 6, pointing at the Phase 2 plan for `providerFactory.ts`/`createProvidersRouter`) states the exact assumed signatures inline (`buildProviderRegistry(config)`, `createProvidersRouter(registry)`) rather than deferring to "whatever Phase 2 did" — if Phase 2 shipped with different names, that's a pre-existing-code mismatch to reconcile at execution time, not a placeholder in this plan.

**Type consistency:** `RoutingConfig = Record<TaskType, { provider: string }>` (Task 1) is used identically in Task 1's own tests, Task 2's `loadRoutingConfigFromFile` return type and `AppConfig.routing` field, and Task 4's bootstrap (`new ProviderRouter(config.routing)`). `ALL_TASK_TYPES` (Task 1) is consumed by Task 2's validation loop with the same five string literals it's defined with. `RoutingContext` (Task 1: `{ hasImageAttachment?, activeSkill?, toolsRequired? }`) is reused without modification in `RunTurnOptions` (Task 3) and `SendMessageOptions` (Task 4) — same field names, same optionality. `AgentRuntime`'s constructor `(registry, storage, router, systemPrompt?)` (Task 3 Step 3) matches its call site in Task 4 Step 6 (`new AgentRuntime(registry, storage, router)`, relying on the `systemPrompt` default). `runTurn(chatId, userMessage, options?: RunTurnOptions)` (Task 3) matches `ChatService.sendMessage`'s forwarding call `this.runtime.runTurn(chatId, content, options)` (Task 4 Step 3) and the test assertions in both Task 3 Step 1 and Task 4 Step 1 (`toHaveBeenCalledWith("c1", "hello", undefined)` for the no-options case, matching `runTurn`'s own default `options: RunTurnOptions = {}` being satisfied by an `undefined` argument at the call site — `sendMessage`'s signature makes `options` optional too, so passing `undefined` through is valid). `ProviderRouter.resolveProviderId`'s return type (`string`, Task 1) matches its use as `AgentRuntime`'s `providerId` local (Task 3 Step 3), which is what gets passed to `registry.get(providerId)` — an untyped-string lookup, exactly like the pre-existing manual-`providerId` path from Phase 2.



