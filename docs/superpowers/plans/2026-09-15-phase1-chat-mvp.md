# Phase 1: Chat + SQLite + OpenAI-compatible provider + streaming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a runnable LLM chat app — Express + SQLite backend, Vue 3 frontend — that lets a user create/list/open/delete chats, send a message, and see a streaming assistant response from any OpenAI-compatible endpoint, with history surviving app restarts.

**Architecture:** Monorepo with npm workspaces. A provider-agnostic `AgentRuntime` (in `packages/agent-core`) depends only on an `LlmProvider` interface and a `ChatStorage` interface — never on concrete providers or SQLite. `packages/providers/openai-compatible` implements `LlmProvider` against any OpenAI-compatible `/chat/completions` endpoint (LM Studio, Ollama, vLLM, OpenAI itself). `packages/storage` implements `ChatStorage` with SQLite (`better-sqlite3`). `apps/api` wires these together behind Express routes and streams an internal `AgentEvent` protocol to the browser over SSE. `apps/web` (Vue 3 + Vite) renders the two-pane chat UI and speaks only the `AgentEvent` protocol, never a provider-specific format. No ProviderRegistry/Router, Skills, ToolRegistry, or MCP yet — those are later phases; this phase's abstractions are sized to not block them.

**Tech Stack:** Node.js (>=22.5, uses built-in `node:sqlite`), TypeScript (strict), Express, SSE via raw `res.write`, Vue 3 (`<script setup>`, Composition API), Vite, Vitest, ESLint (flat config), npm workspaces.

**Decisions worth flagging:**
- SQLite: uses Node's built-in `node:sqlite` (`DatabaseSync`) instead of `better-sqlite3`. This machine has no MSVC build tools (`cl.exe` not found), so a native-compiled dependency is a real install risk; `node:sqlite` is zero-install and confirmed working (verified via a smoke script during planning). It's marked experimental in Node but stable enough for an MVP, and the storage layer is fully abstracted behind `ChatStorage`, so swapping to `better-sqlite3` later is a one-file change if needed.
- `LlmProvider` (spec §4) is implemented with one extra field beyond the spec's literal snippet: a readonly `model: string` alongside `id: string`. Spec §15's `run.started` event and DoD item 18 both require showing the provider *and* model used for a run, but §4's interface as written exposes no way to read the configured model back out. Adding `model` is the minimal fix; `id` remains the registry key (e.g. `"local-fast"`), `model` is the actual model string (e.g. `"qwen3-coder-30b"`).
- No `ProviderRegistry`/`ProviderRouter` yet (those are Phase 2/3 per §24). `apps/api` constructs a single `OpenAICompatibleProvider` from env vars and injects it into `AgentRuntime`. Because `AgentRuntime` only ever sees the `LlmProvider` interface, introducing the registry/router later is additive and doesn't touch `AgentRuntime`.
- No `MAX_TOOL_ITERATIONS` / tool loop yet — there are no tools in Phase 1, so a tool-loop constant would be dead code. It's introduced in the Phase 7 plan when `ToolRegistry` exists.
- `GET /api/providers` is included now (spec §13 lists it as a minimal endpoint) returning the single static provider's `{id, model}`; `GET /api/skills` and `GET /api/mcp` are deferred until their registries exist (Phase 4/6) rather than stubbed.
- Frontend duplicates the small `AgentEvent` union type in `apps/web/src/api/types.ts` instead of importing it from `packages/agent-core`. This avoids wiring TS project references / build coupling between the Vite app and the Node workspace packages for a ~15-line type contract — simpler for the MVP, revisit if the contract grows.
- `AgentEvent` (spec §15) is defined in Phase 1 with only the branches Phase 1 can actually emit: `run.started`, `text.delta`, `run.completed`, `run.error`. The spec's example union also has `tool.started`/`tool.completed`, but there is no tool loop until Phase 7 (`ToolRegistry`) — adding those branches now would be a type with dead branches nothing ever constructs or handles. Phase 7's plan extends this union and the frontend's `switch`.
- `AgentRuntime` (per spec §10 steps 2, 14, 15) owns loading chat history and persisting the assistant message + run — i.e., it depends on a `ChatStorage` interface directly, not just on an in-memory context. `ChatService` (apps/api) is the thin layer above it: chat CRUD (create/list/get/delete) plus delegating "send message" to `AgentRuntime.runTurn(...)`, which returns the `AgentEvent` stream the Express route pipes to SSE. This matches the spec's own component responsibilities in §10 rather than inventing a different split.
- The full 4-table schema from spec §12 (`chats`, `messages`, `runs`, `tool_calls`) is created in this phase even though `tool_calls` stays empty until Phase 6/7 — the spec presents this as *the* MVP schema, not a per-phase one, and creating the table now avoids a migration step later for a table whose shape is already fully specified.
- `runs.message_id` (spec §12) is populated with the **user** message's id, not the assistant reply's id. A run can end in `status: "error"` before any assistant message exists, but the triggering user message always exists — anchoring to it keeps `message_id` non-nullable and consistent across success and error, rather than needing a nullable FK for the error case.
- SQLite access goes through Node's built-in `node:sqlite` (`DatabaseSync`), not a query builder or ORM — the schema is 4 small tables, so raw parameterized SQL via prepared statements is simpler and matches "config instead of hardcode, but no abstraction without need" (§21).
- No `supertest`/HTTP-testing library added for Express route tests. Per §20's explicit unit-test priority list (ProviderRouter, SkillRegistry, ContextBuilder, ToolRegistry, AgentRuntime tool loop), route wiring isn't called out — `ChatService` (the logic behind the routes) gets unit tests with fakes, and the routes themselves are verified by manually curling a running server in Task 7/8's verification steps.
- Spec §17's full error-handling list ("provider unavailable", "timeout", "invalid API key", "user stopped generation", etc.) and §18's structured logging are general requirements, but the spec's own phase ordering (§24) assigns "Tests + error handling + cleanup" to Phase 9. Phase 1 implements the subset that falls out naturally from streaming a real HTTP call (`OpenAICompatibleProvider`'s error events for network failure, non-2xx responses, and a truncated stream — see Task 5) but does not add a stop-generation control, request timeouts, or structured logging — those are deliberately left for the Phase 9 plan rather than half-built here.

---

## File Structure

```text
agenter/
├── package.json                          npm workspaces root, shared scripts
├── tsconfig.base.json                    shared strict compiler options
├── eslint.config.js                      flat ESLint config (TS + Vue)
├── .env.example                          documented env vars, no real secrets
├── .gitignore
├── README.md
│
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  Express app bootstrap, DI wiring
│   │       ├── config.ts                 env var loading (provider + port + db path)
│   │       ├── services/
│   │       │   └── ChatService.ts        chat CRUD + delegates sendMessage to AgentRuntime
│   │       └── routes/
│   │           ├── chats.ts              GET/POST /api/chats, GET/DELETE /api/chats/:id
│   │           ├── providers.ts          GET /api/providers
│   │           └── messages.ts           POST /api/chats/:id/messages (SSE)
│   │
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.ts
│           ├── App.vue                   two-pane layout (Sidebar + ChatView)
│           ├── style.css
│           ├── api/
│           │   ├── types.ts              Chat, Message, AgentEvent (mirrors agent-core)
│           │   └── client.ts             fetch wrappers + SSE-consuming async generator
│           ├── composables/
│           │   └── useChats.ts           reactive chat list/messages/streaming state
│           └── components/
│               ├── Sidebar.vue           new chat, chat list, delete
│               ├── ChatView.vue          message list + streaming render + metadata
│               └── MessageInput.vue      textarea + send button
│
└── packages/
    ├── agent-core/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── types.ts                  LlmProvider, LlmRequest, LlmEvent, AgentEvent, ChatStorage, domain types
    │       ├── ContextBuilder.ts
    │       ├── ContextBuilder.test.ts
    │       ├── AgentRuntime.ts
    │       └── AgentRuntime.test.ts
    │
    ├── storage/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── schema.ts                  CREATE TABLE statements
    │       ├── SqliteChatStorage.ts
    │       └── SqliteChatStorage.test.ts
    │
    └── providers/
        └── openai-compatible/
            ├── package.json
            ├── tsconfig.json
            └── src/
                ├── OpenAICompatibleProvider.ts
                └── OpenAICompatibleProvider.test.ts
```

---

## Prerequisite: upgrade Node.js (do this before Task 1)

This plan uses `node:sqlite` (built-in, no native compile step) and Node's built-in `.ts` execution (`--experimental-strip-types`) instead of `ts-node`. Both need a current Node. Node 24 is the active LTS line as of this plan (confirmed via [nodejs.org releases](https://nodejs.org/en/about/previous-releases) and [endoflife.date/nodejs](https://endoflife.date/nodejs)); the machine currently has v22.19.0.

- [ ] **Step 1: Install Node 24 LTS**

If using `nvm-windows`: `nvm install 24 && nvm use 24`. Otherwise download the Node 24 LTS Windows installer from https://nodejs.org/en/download and run it.

- [ ] **Step 2: Verify the new version and that `node:sqlite` still works**

```bash
node --version
node -e "const {DatabaseSync} = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE t (id INTEGER)'); console.log('node:sqlite OK')"
```

Expected: version starts with `v24.`, and `node:sqlite OK` prints (an `ExperimentalWarning` on stderr is expected and fine).

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: npm workspaces (`apps/*`, `packages/*`, `packages/providers/*`), shared `tsconfig.base.json` every package's `tsconfig.json` extends, root scripts (`typecheck`, `lint`, `test`) that later tasks' packages plug into.

This task has no application logic, so there's no red/green test cycle — the deliverable is verified by running the tooling itself.

- [ ] **Step 1: Create the root `package.json`**

```json
{
  "name": "agenter",
  "private": true,
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*",
    "packages/providers/*"
  ],
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "eslint .",
    "test": "npm run test --workspaces --if-present"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "eslint": "10.10.0",
    "eslint-plugin-vue": "10.11.0",
    "globals": "17.12.0",
    "typescript": "7.0.2",
    "typescript-eslint": "8.70.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 3: Create `eslint.config.js`**

```js
// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
      globals: globals.browser,
    },
  },
  {
    files: ["apps/api/**/*.ts", "packages/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  }
);
```

- [ ] **Step 4: Create `.gitignore`**

```text
node_modules/
dist/
*.db
.env
```

- [ ] **Step 5: Create `.env.example`**

```text
PORT=3000
DB_PATH=./data/agenter.db

PROVIDER_ID=local-fast
PROVIDER_BASE_URL=http://localhost:1234/v1
PROVIDER_API_KEY=local
PROVIDER_MODEL=qwen3-coder-30b
```

- [ ] **Step 6: Create a placeholder `README.md`**

```markdown
# Agenter

Local-first LLM agent chat. See `docs/superpowers/plans/` for the implementation plan.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and point it at your OpenAI-compatible endpoint (LM Studio, Ollama, vLLM, etc.)
3. `npm run dev` (added in Task 7)
```

- [ ] **Step 7: Install and verify the workspace resolves**

```bash
npm install
npm run typecheck
npm run lint
```

Expected: `npm install` succeeds (no native build step — nothing here needs one); `typecheck`/`lint` report "no workspaces found" or pass with zero files, not an error. Fix any error before continuing.

- [ ] **Step 8: Commit**

```bash
git init
git add package.json tsconfig.base.json eslint.config.js .gitignore .env.example README.md
git commit -m "chore: scaffold npm workspaces monorepo"
```

---

## Task 2: agent-core — shared types + ContextBuilder

**Files:**
- Create: `packages/agent-core/package.json`
- Create: `packages/agent-core/tsconfig.json`
- Create: `packages/agent-core/src/types.ts`
- Create: `packages/agent-core/src/ContextBuilder.ts`
- Test: `packages/agent-core/src/ContextBuilder.test.ts`

**Interfaces:**
- Consumes: nothing external (pure domain types + pure function).
- Produces: `LlmProvider`, `LlmRequest`, `LlmEvent`, `ChatMessage`, `ChatRole`, `TokenUsage`, `AgentEvent`, `Chat`, `StoredMessage`, `RunRecord`, `ChatStorage` (all exported from `packages/agent-core/src/types.ts`); `buildContext(input: BuildContextInput): ChatMessage[]` from `ContextBuilder.ts`. Every later task imports these from `@agenter/agent-core`.

- [ ] **Step 1: Create `packages/agent-core/package.json`**

```json
{
  "name": "@agenter/agent-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "vitest": "5.0.0"
  }
}
```

Note: `main`/`types` point at `src/index.ts`, which is created at the end of Task 3 (it re-exports `types.ts`, `ContextBuilder.ts`, and `AgentRuntime.ts` together). Nothing outside this package imports from `@agenter/agent-core` until Task 5, so the dangling reference is harmless until then.

- [ ] **Step 2: Create `packages/agent-core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `packages/agent-core/src/types.ts`**

```ts
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmRequest {
  messages: ChatMessage[];
}

export type LlmEvent =
  | { type: "text.delta"; text: string }
  | { type: "done"; usage?: TokenUsage }
  | { type: "error"; message: string };

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  chat(request: LlmRequest): AsyncIterable<LlmEvent>;
  supportsTools(): boolean;
  supportsVision(): boolean;
  getContextWindow(): number;
}

export type AgentEvent =
  | { type: "run.started"; provider: string; model: string }
  | { type: "text.delta"; text: string }
  | { type: "run.completed"; usage?: TokenUsage }
  | { type: "run.error"; message: string };

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  role: ChatRole;
  content: string;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

export interface NewMessageInput {
  chatId: string;
  role: ChatRole;
  content: string;
  provider?: string;
  model?: string;
}

export interface RunRecord {
  id: string;
  chatId: string;
  messageId: string;
  provider: string;
  model: string;
  status: "success" | "error";
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number;
  createdAt: string;
}

export interface NewRunInput {
  chatId: string;
  messageId: string;
  provider: string;
  model: string;
  status: "success" | "error";
  tokensIn?: number;
  tokensOut?: number;
  durationMs: number;
}

export interface ChatStorage {
  createChat(title: string): Chat;
  listChats(): Chat[];
  getChat(id: string): Chat | undefined;
  deleteChat(id: string): void;
  touchChat(id: string): void;

  listMessages(chatId: string): StoredMessage[];
  addMessage(input: NewMessageInput): StoredMessage;

  addRun(input: NewRunInput): RunRecord;
}
```

- [ ] **Step 4: Write the failing test for `ContextBuilder`**

```ts
// packages/agent-core/src/ContextBuilder.test.ts
import { describe, expect, it } from "vitest";
import { buildContext } from "./ContextBuilder.js";
import type { StoredMessage } from "./types.js";

function storedMessage(overrides: Partial<StoredMessage>): StoredMessage {
  return {
    id: "m1",
    chatId: "c1",
    role: "user",
    content: "hi",
    provider: null,
    model: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildContext", () => {
  it("puts the system prompt first, then history, then the current message", () => {
    const history = [
      storedMessage({ id: "m1", role: "user", content: "earlier question" }),
      storedMessage({ id: "m2", role: "assistant", content: "earlier answer" }),
    ];

    const result = buildContext({
      systemPrompt: "You are a helpful assistant.",
      history,
      currentMessage: "new question",
    });

    expect(result).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "new question" },
    ]);
  });

  it("omits the system message when systemPrompt is empty", () => {
    const result = buildContext({
      systemPrompt: "",
      history: [],
      currentMessage: "hello",
    });

    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });
});
```

- [ ] **Step 5: Run the test, confirm it fails**

```bash
cd packages/agent-core
npx vitest run src/ContextBuilder.test.ts
```

Expected: FAIL — `Cannot find module './ContextBuilder.js'` (file doesn't exist yet).

- [ ] **Step 6: Implement `ContextBuilder.ts`**

```ts
// packages/agent-core/src/ContextBuilder.ts
import type { ChatMessage, StoredMessage } from "./types.js";

export interface BuildContextInput {
  systemPrompt: string;
  history: StoredMessage[];
  currentMessage: string;
}

export function buildContext(input: BuildContextInput): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (input.systemPrompt.length > 0) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  for (const stored of input.history) {
    messages.push({ role: stored.role, content: stored.content });
  }

  messages.push({ role: "user", content: input.currentMessage });

  return messages;
}
```

- [ ] **Step 7: Run the test again, confirm it passes**

```bash
npx vitest run src/ContextBuilder.test.ts
```

Expected: both tests PASS.

- [ ] **Step 8: Install workspace deps and typecheck**

```bash
cd ../..
npm install
npm run typecheck --workspace=@agenter/agent-core
npm run lint
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/agent-core
git commit -m "feat(agent-core): add domain types and ContextBuilder"
```

---

## Task 3: agent-core — AgentRuntime

**Files:**
- Create: `packages/agent-core/src/AgentRuntime.ts`
- Test: `packages/agent-core/src/AgentRuntime.test.ts`
- Create: `packages/agent-core/src/index.ts`
- Modify: `packages/agent-core/package.json` (no change needed — `main`/`types` already point at `index.ts` from Task 2)

**Interfaces:**
- Consumes: `LlmProvider`, `ChatStorage`, `AgentEvent`, `ChatMessage` (from `types.ts`, Task 2); `buildContext` (from `ContextBuilder.ts`, Task 2).
- Produces: `class AgentRuntime` with constructor `(provider: LlmProvider, storage: ChatStorage, systemPrompt?: string)` and method `runTurn(chatId: string, userMessage: string): AsyncGenerator<AgentEvent>`. Task 7 (`apps/api` bootstrap) constructs one `AgentRuntime` and calls `runTurn` per incoming HTTP request.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-core/src/AgentRuntime.test.ts
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./AgentRuntime.js";
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

function fakeProvider(events: LlmEvent[]): LlmProvider {
  return {
    id: "fake",
    model: "fake-model",
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

describe("AgentRuntime.runTurn", () => {
  it("emits run.started, forwards text deltas, then run.completed, and persists both messages", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider([
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "done", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);
    const runtime = new AgentRuntime(provider, storage, "You are helpful.");

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

  it("emits run.error and does not persist an assistant message when the provider errors", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider([{ type: "error", message: "upstream down" }]);
    const runtime = new AgentRuntime(provider, storage, "You are helpful.");

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

Expected: FAIL — `Cannot find module './AgentRuntime.js'`.

- [ ] **Step 3: Implement `AgentRuntime.ts`**

```ts
// packages/agent-core/src/AgentRuntime.ts
import { buildContext } from "./ContextBuilder.js";
import type { AgentEvent, ChatStorage, LlmProvider } from "./types.js";

export class AgentRuntime {
  constructor(
    private readonly provider: LlmProvider,
    private readonly storage: ChatStorage,
    private readonly systemPrompt: string = "You are a helpful assistant."
  ) {}

  async *runTurn(chatId: string, userMessage: string): AsyncGenerator<AgentEvent> {
    const history = this.storage.listMessages(chatId);
    const storedUserMessage = this.storage.addMessage({ chatId, role: "user", content: userMessage });

    const context = buildContext({
      systemPrompt: this.systemPrompt,
      history,
      currentMessage: userMessage,
    });

    yield { type: "run.started", provider: this.provider.id, model: this.provider.model };

    const startedAt = Date.now();
    let assistantText = "";

    for await (const event of this.provider.chat({ messages: context })) {
      if (event.type === "text.delta") {
        assistantText += event.text;
        yield { type: "text.delta", text: event.text };
        continue;
      }

      if (event.type === "error") {
        this.storage.addRun({
          chatId,
          messageId: storedUserMessage.id,
          provider: this.provider.id,
          model: this.provider.model,
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
        provider: this.provider.id,
        model: this.provider.model,
      });

      this.storage.addRun({
        chatId,
        messageId: storedUserMessage.id,
        provider: this.provider.id,
        model: this.provider.model,
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

Expected: both tests PASS.

- [ ] **Step 5: Create the barrel export `packages/agent-core/src/index.ts`**

```ts
export * from "./types.js";
export * from "./ContextBuilder.js";
export * from "./AgentRuntime.js";
```

- [ ] **Step 6: Typecheck and lint the whole package**

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
git commit -m "feat(agent-core): add AgentRuntime orchestration"
```

---

## Task 4: storage — SQLite ChatStorage implementation

**Files:**
- Create: `packages/storage/package.json`
- Create: `packages/storage/tsconfig.json`
- Create: `packages/storage/src/schema.ts`
- Create: `packages/storage/src/SqliteChatStorage.ts`
- Test: `packages/storage/src/SqliteChatStorage.test.ts`
- Create: `packages/storage/src/index.ts`

**Interfaces:**
- Consumes: `ChatStorage`, `Chat`, `StoredMessage`, `NewMessageInput`, `RunRecord`, `NewRunInput` (from `@agenter/agent-core`, Task 2).
- Produces: `class SqliteChatStorage implements ChatStorage` with constructor `(dbPath: string)`. Task 7 (`apps/api` bootstrap) constructs one with the configured `DB_PATH` and injects it into `AgentRuntime`.

- [ ] **Step 1: Create `packages/storage/package.json`**

```json
{
  "name": "@agenter/storage",
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
    "@agenter/agent-core": "0.1.0"
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "vitest": "5.0.0",
    "@types/node": "26.5.1"
  }
}
```

- [ ] **Step 2: Create `packages/storage/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `packages/storage/src/schema.ts`**

```ts
// packages/storage/src/schema.ts
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  arguments TEXT NOT NULL,
  result TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;
```

- [ ] **Step 4: Write the failing test**

```ts
// packages/storage/src/SqliteChatStorage.test.ts
import { unlinkSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteChatStorage } from "./SqliteChatStorage.js";

describe("SqliteChatStorage", () => {
  let storage: SqliteChatStorage;

  beforeEach(() => {
    storage = new SqliteChatStorage(":memory:");
  });

  afterEach(() => {
    storage.close();
  });

  it("creates a chat and lists it", () => {
    const chat = storage.createChat("My chat");

    expect(chat.title).toBe("My chat");
    expect(storage.listChats()).toEqual([chat]);
    expect(storage.getChat(chat.id)).toEqual(chat);
  });

  it("adds messages and lists them in insertion order", () => {
    const chat = storage.createChat("My chat");

    storage.addMessage({ chatId: chat.id, role: "user", content: "hi" });
    storage.addMessage({
      chatId: chat.id,
      role: "assistant",
      content: "hello!",
      provider: "local-fast",
      model: "qwen3",
    });

    const messages = storage.listMessages(chat.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("hi");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.provider).toBe("local-fast");
  });

  it("deletes a chat and cascades its messages", () => {
    const chat = storage.createChat("My chat");
    storage.addMessage({ chatId: chat.id, role: "user", content: "hi" });

    storage.deleteChat(chat.id);

    expect(storage.getChat(chat.id)).toBeUndefined();
    expect(storage.listMessages(chat.id)).toEqual([]);
  });

  it("records a run linked to a message", () => {
    const chat = storage.createChat("My chat");
    const userMessage = storage.addMessage({ chatId: chat.id, role: "user", content: "hi" });

    const run = storage.addRun({
      chatId: chat.id,
      messageId: userMessage.id,
      provider: "local-fast",
      model: "qwen3",
      status: "success",
      tokensIn: 10,
      tokensOut: 5,
      durationMs: 120,
    });

    expect(run.status).toBe("success");
    expect(run.messageId).toBe(userMessage.id);
  });

  it("persists data across instances backed by the same file", () => {
    const filePath = `./.tmp-test-${Date.now()}.db`;
    const first = new SqliteChatStorage(filePath);
    const chat = first.createChat("Persisted chat");
    first.close();

    const second = new SqliteChatStorage(filePath);
    expect(second.getChat(chat.id)?.title).toBe("Persisted chat");
    second.close();

    unlinkSync(filePath);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd packages/storage
npx vitest run src/SqliteChatStorage.test.ts
```

Expected: FAIL — `Cannot find module './SqliteChatStorage.js'`.

- [ ] **Step 6: Implement `SqliteChatStorage.ts`**

```ts
// packages/storage/src/SqliteChatStorage.ts
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  Chat,
  ChatStorage,
  NewMessageInput,
  NewRunInput,
  RunRecord,
  StoredMessage,
} from "@agenter/agent-core";
import { SCHEMA_SQL } from "./schema.js";

export class SqliteChatStorage implements ChatStorage {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  createChat(title: string): Chat {
    const now = new Date().toISOString();
    const chat: Chat = { id: randomUUID(), title, createdAt: now, updatedAt: now };

    this.db
      .prepare(`INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(chat.id, chat.title, chat.createdAt, chat.updatedAt);

    return chat;
  }

  listChats(): Chat[] {
    const rows = this.db
      .prepare(`SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC`)
      .all() as Array<{ id: string; title: string; created_at: string; updated_at: string }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getChat(id: string): Chat | undefined {
    const row = this.db
      .prepare(`SELECT id, title, created_at, updated_at FROM chats WHERE id = ?`)
      .get(id) as { id: string; title: string; created_at: string; updated_at: string } | undefined;

    if (!row) return undefined;

    return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  deleteChat(id: string): void {
    this.db.prepare(`DELETE FROM chats WHERE id = ?`).run(id);
  }

  touchChat(id: string): void {
    this.db
      .prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }

  listMessages(chatId: string): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, chat_id, role, content, provider, model, created_at
         FROM messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC`
      )
      .all(chatId) as Array<{
        id: string;
        chat_id: string;
        role: string;
        content: string;
        provider: string | null;
        model: string | null;
        created_at: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      role: row.role as StoredMessage["role"],
      content: row.content,
      provider: row.provider,
      model: row.model,
      createdAt: row.created_at,
    }));
  }

  addMessage(input: NewMessageInput): StoredMessage {
    const message: StoredMessage = {
      id: randomUUID(),
      chatId: input.chatId,
      role: input.role,
      content: input.content,
      provider: input.provider ?? null,
      model: input.model ?? null,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO messages (id, chat_id, role, content, provider, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.chatId,
        message.role,
        message.content,
        message.provider,
        message.model,
        message.createdAt
      );

    return message;
  }

  addRun(input: NewRunInput): RunRecord {
    const run: RunRecord = {
      id: randomUUID(),
      chatId: input.chatId,
      messageId: input.messageId,
      provider: input.provider,
      model: input.model,
      status: input.status,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      durationMs: input.durationMs,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO runs (id, chat_id, message_id, provider, model, status, tokens_in, tokens_out, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.chatId,
        run.messageId,
        run.provider,
        run.model,
        run.status,
        run.tokensIn,
        run.tokensOut,
        run.durationMs,
        run.createdAt
      );

    return run;
  }
}
```

- [ ] **Step 7: Run test again, confirm it passes**

```bash
npx vitest run src/SqliteChatStorage.test.ts
```

Expected: all 5 tests PASS. (An `ExperimentalWarning` about `node:sqlite` on stderr is expected.)

- [ ] **Step 8: Create `packages/storage/src/index.ts`**

```ts
export * from "./SqliteChatStorage.js";
```

- [ ] **Step 9: Typecheck, lint, test the whole package**

```bash
cd ../..
npm run typecheck --workspace=@agenter/storage
npm run test --workspace=@agenter/storage
npm run lint
```

Expected: no errors, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): add SQLite-backed ChatStorage implementation"
```

---

## Task 5: providers/openai-compatible — OpenAICompatibleProvider

**Files:**
- Create: `packages/providers/openai-compatible/package.json`
- Create: `packages/providers/openai-compatible/tsconfig.json`
- Create: `packages/providers/openai-compatible/src/OpenAICompatibleProvider.ts`
- Test: `packages/providers/openai-compatible/src/OpenAICompatibleProvider.test.ts`
- Create: `packages/providers/openai-compatible/src/index.ts`

**Interfaces:**
- Consumes: `LlmProvider`, `LlmRequest`, `LlmEvent` (from `@agenter/agent-core`, Task 2).
- Produces: `class OpenAICompatibleProvider implements LlmProvider` with constructor `(config: { id: string; baseUrl: string; apiKey: string; model: string; contextWindow?: number })`. Task 7 (`apps/api` bootstrap) constructs one from env vars.

This provider talks to any server implementing the OpenAI `/chat/completions` SSE streaming format (LM Studio, Ollama's OpenAI-compatible endpoint, vLLM, or OpenAI itself) using the global `fetch`, parsing the `data: {...}` / `data: [DONE]` SSE lines itself — no SDK dependency needed for this minimal shape.

- [ ] **Step 1: Create `packages/providers/openai-compatible/package.json`**

```json
{
  "name": "@agenter/provider-openai-compatible",
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
    "@agenter/agent-core": "0.1.0"
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "vitest": "5.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/providers/openai-compatible/tsconfig.json`**

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

- [ ] **Step 3: Write the failing test**

```ts
// packages/providers/openai-compatible/src/OpenAICompatibleProvider.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider.js";

function sseResponse(lines: string[]): Response {
  const body = lines.map((line) => `data: ${line}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("OpenAICompatibleProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yields text.delta for each streamed content chunk, then done with usage", async () => {
    const chunks = [
      JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "lo!" } }] }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      }),
      "[DONE]",
    ];
    vi.mocked(fetch).mockResolvedValue(sseResponse(chunks));

    const provider = new OpenAICompatibleProvider({
      id: "local-fast",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "local",
      model: "qwen3",
    });

    const events = [];
    for await (const event of provider.chat({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "done", usage: { promptTokens: 8, completionTokens: 3 } },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:1234/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer local",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("yields an error event when the HTTP response is not ok", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );

    const provider = new OpenAICompatibleProvider({
      id: "local-fast",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "wrong-key",
      model: "qwen3",
    });

    const events = [];
    for await (const event of provider.chat({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error", message: "Provider request failed: 401 Unauthorized" }]);
  });

  it("yields an error event when fetch rejects (network error)", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const provider = new OpenAICompatibleProvider({
      id: "local-fast",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "local",
      model: "qwen3",
    });

    const events = [];
    for await (const event of provider.chat({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error", message: "ECONNREFUSED" }]);
  });

  it("reports capabilities and context window from config", () => {
    const provider = new OpenAICompatibleProvider({
      id: "local-fast",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "local",
      model: "qwen3",
      contextWindow: 32000,
    });

    expect(provider.supportsTools()).toBe(false);
    expect(provider.supportsVision()).toBe(false);
    expect(provider.getContextWindow()).toBe(32000);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd packages/providers/openai-compatible
npx vitest run src/OpenAICompatibleProvider.test.ts
```

Expected: FAIL — `Cannot find module './OpenAICompatibleProvider.js'`.

- [ ] **Step 5: Implement `OpenAICompatibleProvider.ts`**

```ts
// packages/providers/openai-compatible/src/OpenAICompatibleProvider.ts
import type { LlmEvent, LlmProvider, LlmRequest } from "@agenter/agent-core";

export interface OpenAICompatibleProviderConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow?: number;
}

interface ChatCompletionChunk {
  choices: Array<{ delta: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly contextWindow: number;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.id = config.id;
    this.model = config.model;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.contextWindow = config.contextWindow ?? 8192;
  }

  supportsTools(): boolean {
    return false;
  }

  supportsVision(): boolean {
    return false;
  }

  getContextWindow(): number {
    return this.contextWindow;
  }

  async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          stream: true,
        }),
      });
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
      return;
    }

    if (!response.ok) {
      yield {
        type: "error",
        message: `Provider request failed: ${response.status} ${response.statusText}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "Provider response had no body" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawFinish = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice("data: ".length).trim();
        if (payload === "[DONE]") continue;
        if (payload.length === 0) continue;

        const chunk = JSON.parse(payload) as ChatCompletionChunk;
        const delta = chunk.choices[0]?.delta.content;

        if (delta) {
          yield { type: "text.delta", text: delta };
        }

        if (chunk.choices[0]?.finish_reason) {
          sawFinish = true;
          yield {
            type: "done",
            usage: chunk.usage
              ? {
                  promptTokens: chunk.usage.prompt_tokens,
                  completionTokens: chunk.usage.completion_tokens,
                }
              : undefined,
          };
        }
      }
    }

    if (!sawFinish) {
      yield { type: "error", message: "Provider stream ended without a finish reason" };
    }
  }
}
```

- [ ] **Step 6: Run test again, confirm it passes**

```bash
npx vitest run src/OpenAICompatibleProvider.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 7: Create `packages/providers/openai-compatible/src/index.ts`**

```ts
export * from "./OpenAICompatibleProvider.js";
```

- [ ] **Step 8: Typecheck, lint, test the whole package**

```bash
cd ../../..
npm run typecheck --workspace=@agenter/provider-openai-compatible
npm run test --workspace=@agenter/provider-openai-compatible
npm run lint
```

Expected: no errors, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/providers/openai-compatible
git commit -m "feat(provider-openai-compatible): add streaming OpenAI-compatible provider"
```

---

## Task 6: apps/api — config, ChatService, and chat CRUD routes

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/services/ChatService.ts`
- Test: `apps/api/src/services/ChatService.test.ts`
- Create: `apps/api/src/routes/chats.ts`
- Create: `apps/api/src/routes/providers.ts`

**Interfaces:**
- Consumes: `ChatStorage`, `Chat`, `AgentRuntime` (`@agenter/agent-core`); `SqliteChatStorage` (`@agenter/storage`); `OpenAICompatibleProvider` (`@agenter/provider-openai-compatible`).
- Produces: `loadConfig(): AppConfig` (`{ port, dbPath, provider: { id, baseUrl, apiKey, model } }`); `class ChatService` with `constructor(storage: ChatStorage, runtime: AgentRuntime)`, methods `listChats(): Chat[]`, `createChat(title?: string): Chat`, `getChatWithMessages(id: string): { chat: Chat; messages: StoredMessage[] } | undefined`, `deleteChat(id: string): void`, `sendMessage(chatId: string, content: string): AsyncGenerator<AgentEvent>`. Task 7 mounts the route modules and Task 8 builds `messages.ts` on top of `ChatService.sendMessage`.

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@agenter/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --experimental-strip-types --watch src/index.ts",
    "start": "node --experimental-strip-types src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@agenter/agent-core": "0.1.0",
    "@agenter/storage": "0.1.0",
    "@agenter/provider-openai-compatible": "0.1.0",
    "express": "5.2.1"
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "vitest": "5.0.0",
    "@types/express": "5.0.6",
    "@types/node": "26.5.1"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `apps/api/src/config.ts`**

```ts
// apps/api/src/config.ts
export interface AppConfig {
  port: number;
  dbPath: string;
  provider: {
    id: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? "3000"),
    dbPath: process.env.DB_PATH ?? "./data/agenter.db",
    provider: {
      id: process.env.PROVIDER_ID ?? "local-fast",
      baseUrl: requireEnv("PROVIDER_BASE_URL"),
      apiKey: process.env.PROVIDER_API_KEY ?? "local",
      model: requireEnv("PROVIDER_MODEL"),
    },
  };
}
```

- [ ] **Step 4: Write the failing test for `ChatService`**

```ts
// apps/api/src/services/ChatService.test.ts
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, Chat, ChatStorage, StoredMessage } from "@agenter/agent-core";
import { ChatService } from "./ChatService.js";

function fakeStorage(chats: Chat[] = [], messagesByChat: Record<string, StoredMessage[]> = {}): ChatStorage {
  return {
    createChat: vi.fn((title: string) => {
      const chat: Chat = { id: "new-id", title, createdAt: "t", updatedAt: "t" };
      chats.push(chat);
      return chat;
    }),
    listChats: vi.fn(() => chats),
    getChat: vi.fn((id: string) => chats.find((c) => c.id === id)),
    deleteChat: vi.fn((id: string) => {
      const idx = chats.findIndex((c) => c.id === id);
      if (idx >= 0) chats.splice(idx, 1);
    }),
    touchChat: vi.fn(),
    listMessages: vi.fn((chatId: string) => messagesByChat[chatId] ?? []),
    addMessage: vi.fn(),
    addRun: vi.fn(),
  };
}

function fakeRuntime(events: AgentEvent[]) {
  return {
    runTurn: vi.fn(async function* () {
      for (const event of events) yield event;
    }),
  };
}

describe("ChatService", () => {
  it("creates a chat with a default title when none is given", () => {
    const storage = fakeStorage();
    const service = new ChatService(storage, fakeRuntime([]) as never);

    const chat = service.createChat();

    expect(storage.createChat).toHaveBeenCalledWith("New chat");
    expect(chat.id).toBe("new-id");
  });

  it("lists chats via storage", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const storage = fakeStorage([existing]);
    const service = new ChatService(storage, fakeRuntime([]) as never);

    expect(service.listChats()).toEqual([existing]);
  });

  it("returns chat with messages, or undefined if the chat does not exist", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const message: StoredMessage = {
      id: "m1",
      chatId: "c1",
      role: "user",
      content: "hi",
      provider: null,
      model: null,
      createdAt: "t",
    };
    const storage = fakeStorage([existing], { c1: [message] });
    const service = new ChatService(storage, fakeRuntime([]) as never);

    expect(service.getChatWithMessages("c1")).toEqual({ chat: existing, messages: [message] });
    expect(service.getChatWithMessages("missing")).toBeUndefined();
  });

  it("deletes a chat via storage", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const storage = fakeStorage([existing]);
    const service = new ChatService(storage, fakeRuntime([]) as never);

    service.deleteChat("c1");

    expect(storage.deleteChat).toHaveBeenCalledWith("c1");
  });

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
    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "hello");
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd apps/api
npx vitest run src/services/ChatService.test.ts
```

Expected: FAIL — `Cannot find module './ChatService.js'`.

- [ ] **Step 6: Implement `ChatService.ts`**

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

  async *sendMessage(chatId: string, content: string): AsyncGenerator<AgentEvent> {
    yield* this.runtime.runTurn(chatId, content);
  }
}
```

- [ ] **Step 7: Run test again, confirm it passes**

```bash
npx vitest run src/services/ChatService.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 8: Write `apps/api/src/routes/chats.ts`**

```ts
// apps/api/src/routes/chats.ts
import { Router } from "express";
import type { ChatService } from "../services/ChatService.js";

export function createChatsRouter(chatService: ChatService): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(chatService.listChats());
  });

  router.post("/", (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title : undefined;
    res.status(201).json(chatService.createChat(title));
  });

  router.get("/:id", (req, res) => {
    const result = chatService.getChatWithMessages(req.params.id);
    if (!result) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }
    res.json(result);
  });

  router.delete("/:id", (req, res) => {
    chatService.deleteChat(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 9: Write `apps/api/src/routes/providers.ts`**

```ts
// apps/api/src/routes/providers.ts
import { Router } from "express";
import type { LlmProvider } from "@agenter/agent-core";

export function createProvidersRouter(provider: LlmProvider): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json([{ id: provider.id, model: provider.model }]);
  });

  return router;
}
```

- [ ] **Step 10: Typecheck, lint, test**

```bash
cd ../..
npm install
npm run typecheck --workspace=@agenter/api
npm run test --workspace=@agenter/api
npm run lint
```

Expected: no errors, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api
git commit -m "feat(api): add config, ChatService, chats and providers routes"
```

---

## Task 7: apps/api — SSE messages route and app bootstrap

**Files:**
- Create: `apps/api/src/routes/messages.ts`
- Create: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `ChatService.sendMessage` (Task 6); `AgentEvent` (`@agenter/agent-core`); `loadConfig`, `createChatsRouter`, `createProvidersRouter` (Task 6); `SqliteChatStorage` (`@agenter/storage`, Task 4); `OpenAICompatibleProvider` (`@agenter/provider-openai-compatible`, Task 5); `AgentRuntime` (`@agenter/agent-core`, Task 3).
- Produces: a runnable Express server on `loadConfig().port` exposing all Phase 1 routes. Nothing downstream consumes this — it's the composition root.

This task's deliverable is best verified by actually running the server against a real (or fake) OpenAI-compatible endpoint, not by a unit test — SSE streaming over a live HTTP connection is exactly the kind of thing `supertest` would need extra machinery to exercise well, and the streaming logic itself (`ChatService.sendMessage` → `AgentRuntime.runTurn`) is already unit-tested in Tasks 3 and 6. So this task has a manual verification step instead of a red/green test cycle.

- [ ] **Step 1: Write `apps/api/src/routes/messages.ts`**

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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      for await (const event of chatService.sendMessage(req.params.id, content)) {
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

- [ ] **Step 2: Write `apps/api/src/index.ts`**

```ts
// apps/api/src/index.ts
import express from "express";
import { AgentRuntime } from "@agenter/agent-core";
import { SqliteChatStorage } from "@agenter/storage";
import { OpenAICompatibleProvider } from "@agenter/provider-openai-compatible";
import { loadConfig } from "./config.js";
import { ChatService } from "./services/ChatService.js";
import { createChatsRouter } from "./routes/chats.js";
import { createProvidersRouter } from "./routes/providers.js";
import { createMessagesRouter } from "./routes/messages.js";

const config = loadConfig();

const storage = new SqliteChatStorage(config.dbPath);
const provider = new OpenAICompatibleProvider(config.provider);
const runtime = new AgentRuntime(provider, storage);
const chatService = new ChatService(storage, runtime);

const app = express();
app.use(express.json());

app.use("/api/chats", createChatsRouter(chatService));
app.use("/api/chats", createMessagesRouter(chatService));
app.use("/api/providers", createProvidersRouter(provider));

app.listen(config.port, () => {
  console.log(`agenter api listening on http://localhost:${config.port}`);
});
```

- [ ] **Step 3: Typecheck and lint**

```bash
npm run typecheck --workspace=@agenter/api
npm run lint
```

Expected: no errors. (No new automated tests in this task — see rationale above.)

- [ ] **Step 4: Manually verify the server boots and streams**

Create `.env` from `.env.example`, pointing `PROVIDER_BASE_URL`/`PROVIDER_MODEL` at a running OpenAI-compatible server (LM Studio, Ollama, etc.) reachable right now. Then:

```bash
cd apps/api
node --experimental-strip-types --env-file=../../.env src/index.ts
```

In a second terminal:

```bash
curl -s -X POST http://localhost:3000/api/chats -H "Content-Type: application/json" -d "{\"title\":\"Test\"}"
```

Copy the returned `id`, then:

```bash
curl -N -s -X POST http://localhost:3000/api/chats/<id>/messages -H "Content-Type: application/json" -d "{\"content\":\"Say hello in one short sentence.\"}"
```

Expected: a stream of `data: {"type":"run.started",...}`, several `data: {"type":"text.delta",...}`, and a final `data: {"type":"run.completed",...}` line. Then:

```bash
curl -s http://localhost:3000/api/chats/<id>
```

Expected: JSON with both the user message and the persisted assistant reply. Stop the server (Ctrl+C), restart it, and repeat the last `curl` — the same messages must still be there (persistence across restarts, DoD items 6–8).

If no OpenAI-compatible server is reachable, skip this live check for now but flag it explicitly rather than claiming it was verified — Task 9's end-to-end pass will cover it once the frontend exists too.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add SSE messages route and app bootstrap"
```

---

## Task 8: apps/web — Vite scaffold, API client, and SSE-consuming composable

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.ts`
- Create: `apps/web/src/App.vue` (minimal placeholder, replaced in Task 9)
- Create: `apps/web/src/style.css` (minimal placeholder, replaced in Task 9)
- Create: `apps/web/src/api/types.ts`
- Create: `apps/web/src/api/client.ts`
- Test: `apps/web/src/api/client.test.ts`
- Create: `apps/web/src/composables/useChats.ts`
- Test: `apps/web/src/composables/useChats.test.ts`

**Interfaces:**
- Consumes: nothing from other packages — deliberately decoupled (see "Decisions worth flagging"); it re-declares `Chat`, `StoredMessage`, `AgentEvent` matching the shapes `apps/api` actually serializes (Tasks 2, 6, 7).
- Produces: `listChats()`, `createChat(title?)`, `getChat(id)`, `deleteChat(id)`, `sendMessage(chatId, content): AsyncGenerator<AgentEvent>` from `client.ts`; `useChats()` composable exposing reactive `chats`, `activeChat`, `messages`, `isStreaming`, `sendMessage(content)`. Task 9 builds the Vue components on top of `useChats()`.

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@agenter/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "vue": "3.5.42"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "6.0.9",
    "typescript": "7.0.2",
    "vite": "8.3.0",
    "vitest": "5.0.0",
    "vue-tsc": "3.5.42"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "lib": ["ES2023", "DOM"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
```

- [ ] **Step 4: Create `apps/web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agenter</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/web/src/api/types.ts`**

```ts
// apps/web/src/api/types.ts
export type ChatRole = "system" | "user" | "assistant";

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  role: ChatRole;
  content: string;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export type AgentEvent =
  | { type: "run.started"; provider: string; model: string }
  | { type: "text.delta"; text: string }
  | { type: "run.completed"; usage?: TokenUsage }
  | { type: "run.error"; message: string };
```

- [ ] **Step 6: Write the failing test for the SSE-consuming client function**

```ts
// apps/web/src/api/client.test.ts
import { describe, expect, it, vi } from "vitest";
import { sendMessage } from "./client.js";

function sseResponse(events: object[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200 });
}

describe("sendMessage", () => {
  it("parses each SSE data line into an AgentEvent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "run.started", provider: "p", model: "m" },
          { type: "text.delta", text: "hi" },
          { type: "run.completed" },
        ])
      )
    );

    const events = [];
    for await (const event of sendMessage("chat-1", "hello")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.started", provider: "p", model: "m" },
      { type: "text.delta", text: "hi" },
      { type: "run.completed" },
    ]);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

```bash
cd apps/web
npx vitest run src/api/client.test.ts
```

Expected: FAIL — `Cannot find module './client.js'`.

- [ ] **Step 8: Implement `apps/web/src/api/client.ts`**

```ts
// apps/web/src/api/client.ts
import type { AgentEvent, Chat, StoredMessage } from "./types.js";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function listChats(): Promise<Chat[]> {
  return json(await fetch("/api/chats"));
}

export async function createChat(title?: string): Promise<Chat> {
  return json(
    await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
  );
}

export async function getChat(id: string): Promise<{ chat: Chat; messages: StoredMessage[] }> {
  return json(await fetch(`/api/chats/${id}`));
}

export async function deleteChat(id: string): Promise<void> {
  const response = await fetch(`/api/chats/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
}

export async function* sendMessage(chatId: string, content: string): AsyncGenerator<AgentEvent> {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice("data: ".length).trim();
      if (payload.length === 0) continue;
      yield JSON.parse(payload) as AgentEvent;
    }
  }
}
```

- [ ] **Step 9: Run test again, confirm it passes**

```bash
npx vitest run src/api/client.test.ts
```

Expected: PASS.

- [ ] **Step 10: Write the failing test for `useChats`**

```ts
// apps/web/src/composables/useChats.test.ts
import { describe, expect, it, vi } from "vitest";
import { useChats } from "./useChats.js";
import * as client from "../api/client.js";
import type { AgentEvent, Chat } from "../api/types.js";

describe("useChats", () => {
  it("streams text.delta events into the in-progress assistant message", async () => {
    const chat: Chat = { id: "c1", title: "Chat", createdAt: "t", updatedAt: "t" };

    vi.spyOn(client, "listChats").mockResolvedValue([chat]);
    vi.spyOn(client, "getChat").mockResolvedValue({ chat, messages: [] });

    async function* fakeEvents(): AsyncGenerator<AgentEvent> {
      yield { type: "run.started", provider: "local-fast", model: "qwen3" };
      yield { type: "text.delta", text: "Hel" };
      yield { type: "text.delta", text: "lo!" };
      yield { type: "run.completed" };
    }
    vi.spyOn(client, "sendMessage").mockReturnValue(fakeEvents());

    const { openChat, sendMessage, messages, isStreaming } = useChats();
    await openChat("c1");

    const send = sendMessage("hi there");
    expect(isStreaming.value).toBe(true);
    await send;

    expect(isStreaming.value).toBe(false);
    expect(messages.value.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages.value[1]?.content).toBe("Hello!");
    expect(messages.value[1]?.provider).toBe("local-fast");
  });
});
```

- [ ] **Step 11: Run test to verify it fails**

```bash
npx vitest run src/composables/useChats.test.ts
```

Expected: FAIL — `Cannot find module './useChats.js'`.

- [ ] **Step 12: Implement `apps/web/src/composables/useChats.ts`**

```ts
// apps/web/src/composables/useChats.ts
import { ref } from "vue";
import * as client from "../api/client.js";
import type { Chat, StoredMessage } from "../api/types.js";

export function useChats() {
  const chats = ref<Chat[]>([]);
  const activeChat = ref<Chat | null>(null);
  const messages = ref<StoredMessage[]>([]);
  const isStreaming = ref(false);
  const currentModelLabel = ref<string | null>(null);

  async function refreshChats(): Promise<void> {
    chats.value = await client.listChats();
  }

  async function openChat(chatId: string): Promise<void> {
    const result = await client.getChat(chatId);
    activeChat.value = result.chat;
    messages.value = result.messages;
  }

  async function newChat(): Promise<void> {
    const chat = await client.createChat();
    await refreshChats();
    await openChat(chat.id);
  }

  async function removeChat(chatId: string): Promise<void> {
    await client.deleteChat(chatId);
    if (activeChat.value?.id === chatId) {
      activeChat.value = null;
      messages.value = [];
    }
    await refreshChats();
  }

  async function sendMessage(content: string): Promise<void> {
    if (!activeChat.value) return;
    const chatId = activeChat.value.id;

    messages.value.push({
      id: `local-${Date.now()}`,
      chatId,
      role: "user",
      content,
      provider: null,
      model: null,
      createdAt: new Date().toISOString(),
    });

    isStreaming.value = true;
    let assistantText = "";
    let provider: string | null = null;
    let model: string | null = null;

    try {
      for await (const event of client.sendMessage(chatId, content)) {
        if (event.type === "run.started") {
          provider = event.provider;
          model = event.model;
          currentModelLabel.value = event.model;
        } else if (event.type === "text.delta") {
          assistantText += event.text;
        } else if (event.type === "run.error") {
          assistantText = `⚠ ${event.message}`;
        }
      }
    } finally {
      isStreaming.value = false;
    }

    messages.value.push({
      id: `local-${Date.now()}-assistant`,
      chatId,
      role: "assistant",
      content: assistantText,
      provider,
      model,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    chats,
    activeChat,
    messages,
    isStreaming,
    currentModelLabel,
    refreshChats,
    openChat,
    newChat,
    removeChat,
    sendMessage,
  };
}
```

- [ ] **Step 13: Run test again, confirm it passes**

```bash
npx vitest run src/composables/useChats.test.ts
```

Expected: PASS.

- [ ] **Step 14: Create `apps/web/src/main.ts`**

```ts
// apps/web/src/main.ts
import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

createApp(App).mount("#app");
```

- [ ] **Step 15: Create a minimal `apps/web/src/App.vue` and `apps/web/src/style.css` so this task typechecks and builds cleanly on its own — Task 9 replaces both with the real layout**

```vue
<!-- apps/web/src/App.vue -->
<script setup lang="ts"></script>

<template>
  <div id="layout">Agenter — UI coming in the next task.</div>
</template>
```

```css
/* apps/web/src/style.css */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
}
```

- [ ] **Step 16: Typecheck, lint, test**

```bash
cd ../..
npm install
npm run typecheck --workspace=@agenter/web
npm run test --workspace=@agenter/web
npm run lint
```

Expected: no errors, all tests pass.

- [ ] **Step 17: Commit**

```bash
git add apps/web
git commit -m "feat(web): add Vite scaffold, API client, and useChats composable"
```

---

## Task 9: apps/web — Sidebar, ChatView, MessageInput and the real App.vue layout

**Files:**
- Create: `apps/web/src/components/Sidebar.vue`
- Create: `apps/web/src/components/MessageInput.vue`
- Create: `apps/web/src/components/ChatView.vue`
- Modify: `apps/web/src/App.vue` (replace Task 8's placeholder)
- Modify: `apps/web/src/style.css` (replace Task 8's placeholder)

**Interfaces:**
- Consumes: `useChats()` (Task 8) — `chats`, `activeChat`, `messages`, `isStreaming`, `currentModelLabel`, `refreshChats`, `openChat`, `newChat`, `removeChat`, `sendMessage`; `Chat`, `StoredMessage` types (Task 8).
- Produces: the rendered two-pane chat UI per spec §14. Nothing downstream consumes these — they're leaf UI components. No unit tests: Vue component rendering for this simple, mostly-template UI is verified by manual browser testing in Step 6, per the guideline to test UI changes in a real browser rather than writing shallow snapshot tests for template-only components.

- [ ] **Step 1: Create `apps/web/src/components/Sidebar.vue`**

```vue
<!-- apps/web/src/components/Sidebar.vue -->
<script setup lang="ts">
import type { Chat } from "../api/types.js";

const props = defineProps<{
  chats: Chat[];
  activeChatId: string | null;
}>();

const emit = defineEmits<{
  newChat: [];
  selectChat: [id: string];
  deleteChat: [id: string];
}>();
</script>

<template>
  <aside class="sidebar">
    <button class="new-chat-button" type="button" @click="emit('newChat')">+ New Chat</button>
    <ul class="chat-list">
      <li
        v-for="chat in props.chats"
        :key="chat.id"
        :class="{ active: chat.id === props.activeChatId }"
        class="chat-list-item"
      >
        <button type="button" class="chat-title" @click="emit('selectChat', chat.id)">
          {{ chat.title }}
        </button>
        <button type="button" class="delete-button" aria-label="Delete chat" @click="emit('deleteChat', chat.id)">
          ×
        </button>
      </li>
    </ul>
  </aside>
</template>
```

- [ ] **Step 2: Create `apps/web/src/components/MessageInput.vue`**

```vue
<!-- apps/web/src/components/MessageInput.vue -->
<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  disabled: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
}>();

const draft = ref("");

function submit(): void {
  const content = draft.value.trim();
  if (content.length === 0 || props.disabled) return;
  emit("send", content);
  draft.value = "";
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <form class="message-input" @submit.prevent="submit">
    <textarea
      v-model="draft"
      :disabled="props.disabled"
      placeholder="Message..."
      rows="2"
      @keydown="onKeydown"
    />
    <button type="submit" :disabled="props.disabled || draft.trim().length === 0">Send</button>
  </form>
</template>
```

- [ ] **Step 3: Create `apps/web/src/components/ChatView.vue`**

```vue
<!-- apps/web/src/components/ChatView.vue -->
<script setup lang="ts">
import type { StoredMessage } from "../api/types.js";
import MessageInput from "./MessageInput.vue";

defineProps<{
  messages: StoredMessage[];
  isStreaming: boolean;
  hasActiveChat: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
}>();
</script>

<template>
  <section class="chat-view">
    <div v-if="!hasActiveChat" class="empty-state">Select or create a chat to get started.</div>

    <template v-else>
      <div class="message-list">
        <div v-for="message in messages" :key="message.id" class="message" :class="message.role">
          <div class="message-role">{{ message.role }}</div>
          <div class="message-content">{{ message.content }}</div>
          <div v-if="message.role === 'assistant' && message.model" class="message-meta">
            {{ message.model }}
          </div>
        </div>
        <div v-if="isStreaming" class="message assistant streaming">
          <div class="message-role">assistant</div>
          <div class="message-content">…</div>
        </div>
      </div>

      <MessageInput :disabled="isStreaming" @send="(content) => emit('send', content)" />
    </template>
  </section>
</template>
```

- [ ] **Step 4: Replace `apps/web/src/App.vue`**

```vue
<!-- apps/web/src/App.vue -->
<script setup lang="ts">
import { onMounted } from "vue";
import { useChats } from "./composables/useChats.js";
import Sidebar from "./components/Sidebar.vue";
import ChatView from "./components/ChatView.vue";

const { chats, activeChat, messages, isStreaming, refreshChats, newChat, openChat, removeChat, sendMessage } =
  useChats();

onMounted(() => {
  void refreshChats();
});

async function handleDelete(id: string): Promise<void> {
  await removeChat(id);
}
</script>

<template>
  <div class="layout">
    <Sidebar
      :chats="chats"
      :active-chat-id="activeChat?.id ?? null"
      @new-chat="newChat"
      @select-chat="openChat"
      @delete-chat="handleDelete"
    />
    <ChatView
      :messages="messages"
      :is-streaming="isStreaming"
      :has-active-chat="activeChat !== null"
      @send="sendMessage"
    />
  </div>
</template>
```

- [ ] **Step 5: Replace `apps/web/src/style.css`**

```css
/* apps/web/src/style.css */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: #1a1a1a;
}

.layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  height: 100vh;
}

.sidebar {
  background: #f5f5f5;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 8px;
}

.new-chat-button {
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: white;
  cursor: pointer;
}

.chat-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}

.chat-list-item {
  display: flex;
  align-items: center;
  border-radius: 6px;
}

.chat-list-item.active {
  background: #e0e0ff;
}

.chat-title {
  flex: 1;
  text-align: left;
  background: none;
  border: none;
  padding: 8px;
  cursor: pointer;
}

.delete-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  color: #888;
}

.chat-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.empty-state {
  margin: auto;
  color: #888;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.message {
  margin-bottom: 16px;
  max-width: 70%;
}

.message.user {
  margin-left: auto;
  text-align: right;
}

.message-role {
  font-size: 12px;
  color: #888;
  text-transform: uppercase;
}

.message-content {
  white-space: pre-wrap;
}

.message-meta {
  font-size: 11px;
  color: #aaa;
}

.message-input {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #ddd;
}

.message-input textarea {
  flex: 1;
  resize: none;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-family: inherit;
}

.message-input button {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #4a4af0;
  color: white;
  cursor: pointer;
}

.message-input button:disabled {
  background: #ccc;
  cursor: default;
}
```

- [ ] **Step 6: Typecheck, lint, and manually verify in a browser**

```bash
npm run typecheck --workspace=@agenter/web
npm run lint
```

Expected: no errors.

Then, with `apps/api` running (per Task 7 Step 4, against a real OpenAI-compatible endpoint) start the frontend dev server:

```bash
npm run dev --workspace=@agenter/web
```

Open the printed local URL in a browser and confirm the full golden path:
- sidebar shows "+ New Chat" and an empty chat list;
- clicking "+ New Chat" creates a chat and selects it;
- typing a message and pressing Enter (or clicking Send) shows the user message immediately, then the assistant reply streams in token by token;
- the assistant message shows its model name;
- reloading the page and reopening the chat shows the full saved history;
- deleting a chat removes it from the sidebar and clears the chat view if it was active.

If no live OpenAI-compatible server was reachable in Task 7, note that here too and treat this as unverified rather than claiming success.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add Sidebar, ChatView, MessageInput and wire up App.vue"
```

---

## Task 10: Root dev script, README, and full verification pass

**Files:**
- Modify: `package.json` (root — add a `dev` script)
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing new — this task wires up what Tasks 1–9 already built.
- Produces: `npm run dev` runnable from the repo root, and a README that documents the actual setup/run steps. This is the last task in the plan.

- [ ] **Step 1: Add a root `dev` script that runs both apps**

No `concurrently`-style dependency is added — Node's job control handles two background processes fine for a local dev script, and adding a dependency for this is unnecessary per the global constraint against extra deps.

Update the root `package.json` `scripts` block:

```json
{
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "eslint .",
    "test": "npm run test --workspaces --if-present",
    "dev:api": "npm run dev --workspace=@agenter/api",
    "dev:web": "npm run dev --workspace=@agenter/web"
  }
}
```

(Two scripts, `dev:api` and `dev:web`, run in separate terminals — documented in the README below — rather than one combined `dev` script, so output from each isn't interleaved and either can be restarted independently.)

- [ ] **Step 2: Update `README.md` with real setup and run instructions**

```markdown
# Agenter

Local-first LLM agent chat. Backend: Node.js/Express/SQLite. Frontend: Vue 3/Vite.
See `docs/superpowers/plans/` for the implementation plan.

## Requirements

- Node.js 24 LTS or newer (uses the built-in `node:sqlite` module)
- An OpenAI-compatible LLM endpoint reachable from this machine (LM Studio, Ollama, vLLM, or OpenAI itself)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `PROVIDER_BASE_URL` and `PROVIDER_MODEL` to point at your endpoint
3. In one terminal: `npm run dev:api`
4. In another terminal: `npm run dev:web`
5. Open the URL Vite prints (typically `http://localhost:5173`)

## Verification

```bash
npm run typecheck
npm run lint
npm run test
```
```

- [ ] **Step 3: Run the full verification suite from the repo root**

```bash
npm install
npm run typecheck
npm run lint
npm run test
```

Expected: all workspaces typecheck cleanly, lint reports zero errors, and every test suite from Tasks 2–8 passes (`agent-core`: `ContextBuilder`, `AgentRuntime`; `storage`: `SqliteChatStorage`; `provider-openai-compatible`: `OpenAICompatibleProvider`; `api`: `ChatService`; `web`: `client`, `useChats`). Fix anything that fails before considering Phase 1 done — do not report success without having actually run these.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "chore: add root dev scripts and finalize README"
```

---

## Phase 1 Definition of Done

Matches the applicable subset of spec §23 (items 1–9; items 10+ require Provider Router, Skills, and MCP, which are out of scope for Phase 1 per spec §24):

1. Backend runs (`npm run dev:api`).
2. Frontend runs (`npm run dev:web`).
3. Create a chat (Sidebar "+ New Chat").
4. Send a message.
5. See a streaming response (token-by-token in ChatView).
6. Close the app (stop both processes).
7. Reopen the app.
8. Continue a saved chat (history loads from SQLite via `GET /api/chats/:id`).
9. See the model used for a run (shown under each assistant message).

Deferred to later phases per spec §24 and explicitly out of scope here: manual/auto provider switching (Phase 2/3), Skills (Phase 4), MCP tools (Phase 5/6), tool-call UI (Phase 7/8), the broader test/error-handling pass (Phase 9).
