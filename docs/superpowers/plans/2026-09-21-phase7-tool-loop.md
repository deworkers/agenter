# Phase 7: Agent Tool Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the model call registered safe tools, receive tool results in context, and continue to one final answer through a bounded provider-neutral loop.

**Architecture:** Extend `agent-core` with neutral tool-call messages/events and an injected agent-tool interface. The OpenAI-compatible adapter assembles streamed tool-call fragments and maps neutral request history to the wire protocol. `AgentRuntime` executes complete assistant tool-call turns sequentially, caps iterations at 10, and persists one terminal run plus tool-call records through `ChatStorage`. The API adapts the shared `ToolRegistry` to the neutral runtime contract, exposing only safe definitions while keeping registry execution as the security gate.

**Tech Stack:** Node.js >=24, TypeScript strict, existing npm workspaces, SQLite (`node:sqlite`), Express SSE, Vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-23-phase7-tool-loop-design.md`; product requirements `PROMT.md` §§3, 6–12, 15, 17–20, 24.

## Global Constraints

- `MAX_TOOL_ITERATIONS = 10`; one iteration is one assistant response containing one or more tool calls.
- Execute tool calls sequentially in provider order. Stop on the first failure in a response; mark remaining calls skipped.
- `agent-core` depends only on provider-neutral contracts; do not import `@agenter/tools`, MCP SDK, Express, or SQLite there.
- OpenAI-compatible wire types stay in `packages/providers/openai-compatible`.
- Execute only through `ToolRegistry`; expose only `safe` tool definitions to providers.
- Expand no new HTTP endpoint or UI; keep existing SSE route protocol and forward the new neutral events.
- Store terminal run plus all accumulated tool-call records after success or handled error; use the existing `tool_calls` table, no schema migration.
- Tool-call arguments/results stored in SQLite and returned to providers are JSON text; reject malformed/non-object arguments and non-serializable results safely.
- No real LLM, MCP process, API dev server, or watch process is required for tests. Unit and integration tests use fakes/mocks and terminate their ephemeral listeners.
- Preserve Node >=24, strict TypeScript and existing npm workspace dependencies.

---

## File Map

| File | Responsibility |
|---|---|
| `packages/agent-core/src/types.ts` | Provider-neutral call/history/event types, `AgentToolRuntime`, and tool-call storage types. |
| `packages/providers/openai-compatible/src/OpenAICompatibleProvider.ts` | OpenAI-compatible tool definitions/messages and streamed tool-call assembly; no runtime/storage logic. |
| `packages/providers/openai-compatible/src/OpenAICompatibleProvider.test.ts` | Mocked SSE fragmentation, request serialization, text/usage and malformed tool-call tests. |
| `packages/storage/src/SqliteChatStorage.ts` | Atomic terminal run + tool-call persistence using existing schema. |
| `packages/storage/src/SqliteChatStorage.test.ts` | Isolated SQLite persistence and rollback tests. |
| `packages/agent-core/src/AgentRuntime.ts` | Bounded provider-neutral loop, ordered registry calls, events and run finalization. |
| `packages/agent-core/src/AgentRuntime.test.ts` | Fake-provider/tool/storage state-machine and failure tests. |
| `apps/api/src/agentToolRuntime.ts` | Adapt registry to agent-core interface; list safe metadata only and delegate execution to registry. |
| `apps/api/src/agentToolRuntime.test.ts` | Verify safety filtering and common-registry execution. |
| `apps/api/src/index.ts` | Start MCP registry before constructing runtime, inject adapter, preserve route wiring. |
| `apps/api/src/services/ChatService.test.ts` | Verify transparent forwarding of tool events through ChatService. |
| `apps/api/src/routes/messages.test.ts` | Mocked-provider runtime through ChatService and SSE serialization of tool lifecycle events. |
| `docs/superpowers/ROADMAP.md` | Mark Phase 7 implemented only after final evidence. |

## Public Contracts

Add these provider-neutral contracts in `packages/agent-core/src/types.ts`:

```ts
export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface AssistantToolCallMessage {
  role: "assistant";
  content: string | null;
  toolCalls: ToolCall[];
}

export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
}

export type LlmMessage = ChatMessage | AssistantToolCallMessage | ToolResultMessage;

export interface AgentToolRuntime {
  listTools(): ToolDefinition[];
  execute(name: string, args: unknown): Promise<unknown>;
}

export interface LlmRequest {
  messages: LlmMessage[];
  tools?: ToolDefinition[];
}

export type LlmEvent =
  | { type: "text.delta"; text: string }
  | { type: "tool.call"; call: ToolCall }
  | { type: "done"; usage?: TokenUsage }
  | { type: "error"; message: string };

export type AgentEvent =
  | { type: "run.started"; provider: string; model: string }
  | { type: "text.delta"; text: string }
  | { type: "tool.started"; tool: string; arguments: unknown }
  | { type: "tool.completed"; tool: string; result: unknown }
  | { type: "run.completed"; usage?: TokenUsage }
  | { type: "run.error"; message: string };

export type ToolCallStatus = "success" | "error" | "skipped";

export interface NewToolCallInput {
  toolName: string;
  arguments: string;
  result: string | null;
  status: ToolCallStatus;
}

export interface ToolCallRecord extends NewToolCallInput {
  id: string;
  runId: string;
  createdAt: string;
}

export interface ChatStorage {
  completeRun(
    input: NewRunInput,
    toolCalls: NewToolCallInput[],
    assistantMessage?: NewMessageInput
  ): RunRecord;
}
```

`LlmRequest.messages` becomes `LlmMessage[]` and gains optional
`tools?: ToolDefinition[]`. `LlmEvent` gains
`{ type: "tool.call"; call: ToolCall }`. `AgentEvent` gains
`tool.started { tool, arguments }` and `tool.completed { tool, result }`.
`ChatStorage` gains
`completeRun(input: NewRunInput, toolCalls: NewToolCallInput[], assistantMessage?: NewMessageInput): RunRecord`.
That operation atomically inserts the terminal run and associated call rows,
plus on success the final assistant message and chat timestamp. Error runs pass
no assistant message. Existing `addRun()` behavior remains available.

`AgentRuntime` receives an options object:

```ts
export interface AgentRuntimeOptions {
  systemPrompt?: string;
  toolRuntime?: AgentToolRuntime;
  maxToolIterations?: number; // default 10
}
```

Keep the existing 3-argument `new AgentRuntime(registry, storage, router)` call
valid; update tests that currently pass the system prompt as the fourth
positional argument to use `{ systemPrompt: "..." }`.

## Tasks

### Task 1: Define neutral protocol, adapter, and fail-closed runtime fallback

**Files:** Modify `packages/agent-core/src/types.ts`, `packages/agent-core/src/AgentRuntime.ts`, `packages/agent-core/src/AgentRuntime.test.ts`, `packages/providers/openai-compatible/src/OpenAICompatibleProvider.ts`, and `packages/providers/openai-compatible/src/OpenAICompatibleProvider.test.ts` only. Task 3 later owns the same `AgentRuntime.ts` and test sequentially to replace the temporary fallback with the actual loop.

- [x] **Step 1:** Add failing fake-provider runtime test: with no `AgentToolRuntime` configured, an unexpected `tool.call` must emit sanitized `run.error`, persist one error run, and never persist an assistant success or execute anything. Add mocked-fetch tests for two calls returned in interleaved SSE fragments; verify each call is emitted once with concatenated JSON arguments, non-empty id/name, parsed object args, and `done` follows the calls. Assert ordinary text-only streaming remains unchanged.

  The expected normalized event shape for the fragmented call fixture is:

  ```ts
  { type: "tool.call", call: { id: "call-1", name: "lookup", arguments: { query: "x" } } }
  ```
- [x] **Step 2:** Run `npm test --workspace=@agenter/agent-core` and `npm test --workspace=@agenter/provider-openai-compatible` (each 60000ms), plus `npm run typecheck --workspace=@agenter/agent-core` (60000ms). Confirm failing assertions/typing demonstrate the missing safe call branch and provider adapter.
- [x] **Step 3:** Add provider-neutral `ToolCall`, `AssistantToolCallMessage`, `ToolResultMessage`, `LlmMessage`, `AgentToolRuntime`, `LlmRequest.tools`, `LlmEvent.tool.call`, `AgentEvent.tool.started/tool.completed`, `ToolCallStatus`, and `NewToolCallInput` contracts exactly as defined above.
- [x] **Step 4:** Extend SSE chunk types for `delta.tool_calls[index].id`, `function.name`, `function.arguments`, `finish_reason`, and usage. Buffer each call by index; require unique non-empty id/name; concatenate argument fragments; parse arguments as a JSON object; emit one sanitized error on malformed data and never include raw args in the message.
- [x] **Step 5:** Map neutral assistant tool-call history to `{ role:"assistant", content, tool_calls:[{id,type:"function",function:{name,arguments:JSON.stringify(arguments)}}] }`, tool results to `{role:"tool",tool_call_id,name,content}`, and definitions to OpenAI-compatible `{type:"function",function:{name,description,parameters:inputSchema}}`. Include tool definitions in request JSON only when provided. Change `supportsTools()` to return true.
- [x] **Step 6:** In the current one-shot `AgentRuntime`, explicitly handle an incoming `tool.call` as a sanitized `run.error` when no tool runtime is configured; never let it fall through to the `done` branch or execute. Task 3 replaces this fail-closed branch with the loop.
- [x] **Step 7:** Continue reading through `[DONE]`/stream end after a finish chunk, aggregate any usage, emit calls before one final `done`, and preserve current text delta, non-2xx and network error behavior.
- [x] **Step 8:** Run `npm test --workspace=@agenter/agent-core`, `npm run typecheck --workspace=@agenter/agent-core`, `npm test --workspace=@agenter/provider-openai-compatible`, and `npm run typecheck --workspace=@agenter/provider-openai-compatible` (each timeout 60000ms).

### Task 2: Persist terminal runs and tool calls atomically

**Files:** Modify `packages/agent-core/src/types.ts`, `packages/agent-core/src/AgentRuntime.test.ts`, `apps/api/src/services/ChatService.test.ts`, `packages/storage/src/SqliteChatStorage.ts`, and `packages/storage/src/SqliteChatStorage.test.ts`. `types.ts` already has Task 1 changes; preserve them. Add a `completeRun` fake to both existing `ChatStorage` test doubles so all workspaces continue to typecheck after the interface extension; Task 3 and Task 5 may extend their own test behavior later, strictly sequentially.

- [x] **Step 1:** Add an in-memory SQLite test calling `completeRun()` with one successful and one skipped call plus a final assistant message; verify the run ID links the exact call rows and JSON text/status, the assistant message is saved, and the chat timestamp is touched. Verify error completion without an assistant input saves no assistant message.
- [x] **Step 2:** Add an atomic rollback test that first inserts a valid assistant message, run and one valid call row, then makes the second call insert violate `tool_name NOT NULL` using `toolName: null as unknown as string`. In the test, access the private database with `const db = (storage as unknown as { db: DatabaseSync }).db`, query counts for runs/tool_calls/assistant messages and chat updated_at, and assert every transaction effect is rolled back. Import `DatabaseSync` from `node:sqlite` only in the test; do not add a production list/query API solely for the test.
- [x] **Step 3:** Run `npm test --workspace=@agenter/storage` (timeout 60000ms); confirm new tests fail before implementation.
- [x] **Step 4:** Define `ToolCallRecord` with `id`, `runId`, `toolName`, `arguments`, `result`, `status`, and `createdAt`. Extend `ChatStorage.completeRun()` with `assistantMessage?: NewMessageInput`. Update `fakeStorage()` in `AgentRuntime.test.ts` and `ChatService.test.ts` with typed stubs accepting the optional assistant message; do not add loop/SSE behavior assertions in these compatibility edits.
- [x] **Step 5:** Implement `SqliteChatStorage.completeRun()` with one SQLite transaction: if `assistantMessage` exists, insert it and update the chat timestamp; insert the run; insert each call with generated UUID and returned run ID; commit and return the run. On any error roll back every insert/update and rethrow. Error runs pass no assistant message. Do not change `SCHEMA_SQL` or existing `addRun()` behavior.

  Each call row maps exactly as follows:

  ```ts
  {
    id: randomUUID(), run_id: run.id, tool_name: call.toolName,
    arguments: call.arguments, result: call.result,
    status: call.status, created_at: new Date().toISOString()
  }
  ```
- [x] **Step 6:** Run `npm test --workspace=@agenter/storage`, `npm run typecheck --workspace=@agenter/storage`, `npm run typecheck --workspace=@agenter/agent-core`, and `npm run typecheck --workspace=@agenter/api` (each timeout 60000ms).

### Task 3: Implement the bounded AgentRuntime tool loop

**Files:** Modify `packages/agent-core/src/AgentRuntime.ts` and `packages/agent-core/src/AgentRuntime.test.ts` only.

- [x] **Step 1:** Add failing fake-provider/tool/storage tests for one call then final text, multiple calls executed sequentially, correlated assistant/tool messages, aggregated usage and event order. Include unknown/unsafe failures, malformed args, mixed valid/invalid call batches (`error` for the first malformed call and `skipped` for other unexecuted calls), non-serializable results, skipped later calls, streams ending without `done`, `completeRun` rejection without assistant persistence, and a small injected iteration limit.

  Assert the ordered event subsequence for one successful tool call:

  ```ts
  ["run.started", "tool.started", "tool.completed", "text.delta", "run.completed"]
  ```
- [x] **Step 2:** Run `npm test --workspace=@agenter/agent-core` (timeout 60000ms); verify the new loop tests fail before implementation.
- [x] **Step 3:** Add exported `MAX_TOOL_ITERATIONS = 10` and `AgentRuntimeOptions`; keep `systemPrompt` default and current 3-argument construction. Obtain safe tool definitions once per run from `toolRuntime.listTools()`.
- [x] **Step 4:** For `mode:"auto"`, set `routingContext.toolsRequired` to `toolDefinitions.length > 0` while preserving image/skill fields; explicit `providerId` and manual routing remain unchanged. Include `tools` in `LlmRequest` only when the selected provider reports `supportsTools()` and safe definitions exist.
- [x] **Step 5:** Implement each provider turn as a fresh stream over the current message union. Track explicit `done`; an unfinished stream fails and skips any collected calls. Accumulate text and complete calls until `done`; on no calls atomically persist final assistant text. On calls, append one assistant call message, execute calls serially, emit `tool.started`/`tool.completed`, append a correlated tool result per success, then loop.
- [x] **Step 6:** Reject malformed call IDs/names/args and non-JSON results before continuing. For a malformed batch, mark the first malformed call `error` and all other unexecuted calls `skipped`. After first execution failure, do not execute later calls; save error/skipped records and emit one `run.error`. After ten executed tool-call rounds, allow one final-answer provider request but skip and fail any eleventh tool-call round. Accumulate token usage across all rounds.
- [x] **Step 7:** Finalize exactly once through `storage.completeRun(...)` on success or handled error. On success pass final assistant `NewMessageInput` so assistant/run/tool records/chat timestamp commit atomically; on error pass no assistant. Keep intermediate protocol messages only in request context. Do not separately call `addMessage` or `touchChat` for the final assistant. If `completeRun` rejects, emit a fixed sanitized `run.error` and do not persist assistant success separately.
- [x] **Step 8:** If a provider stream ends without `done` or an explicit error, fail the run. Any complete calls collected from that unfinished response are not executed and are recorded as skipped.
- [x] **Step 9:** Run `npm test --workspace=@agenter/agent-core` and `npm run typecheck --workspace=@agenter/agent-core` (each timeout 60000ms).

### Task 4: Adapt ToolRegistry and wire runtime in API

**Files:** Create `apps/api/src/agentToolRuntime.ts` and `apps/api/src/agentToolRuntime.test.ts`; modify `apps/api/src/index.ts` only.

- [x] **Step 1:** Add a failing adapter test with safe, approval-required and disabled registry tools. Assert the adapter returns only `{name,description,inputSchema}` for safe tools and delegates execution to the same registry.
- [x] **Step 2:** Run `npm test --workspace=@agenter/api` (timeout 60000ms); confirm the adapter import/test fails before implementation.
- [x] **Step 3:** Implement `createAgentToolRuntime(registry)` matching the `AgentToolRuntime` interface, filtering definitions to `safety === "safe"`, and delegating `execute(name,args)` to `registry.execute(name,args)`.
- [x] **Step 4:** In `index.ts`, construct local/MCP shared registry and start MCP as today before constructing `AgentRuntime`; pass `{ toolRuntime: createAgentToolRuntime(tools) }`. Preserve every existing route, the `/api/mcp` route, app.locals registry, and shutdown wiring.

  Adapter contract:

  ```ts
  return {
    listTools: () => registry.list()
      .filter(({ safety }) => safety === "safe")
      .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    execute: (name, args) => registry.execute(name, args),
  };
  ```
- [x] **Step 5:** Run `npm test --workspace=@agenter/api` and `npm run typecheck --workspace=@agenter/api` (each timeout 60000ms). Do not start API/web dev servers.

### Task 5: Verify ChatService and SSE tool-event propagation

**Files:** Modify `apps/api/src/services/ChatService.test.ts`; create `apps/api/src/routes/messages.test.ts` only.

- [x] **Step 1:** Update the API `fakeStorage()` to implement the new `completeRun()` contract without changing existing ChatService tests. Add tool lifecycle events to a ChatService forwarding test and assert exact order/payloads.
- [x] **Step 2:** Add one finite loopback SSE test using Express `createMessagesRouter`, `ChatService`, real `AgentRuntime`, fake provider, in-memory fake storage, and the registry adapter. The provider emits one tool call then final text; assert SSE contains `tool.started`, `tool.completed`, final `text.delta`, and `run.completed` in order and no provider wire payload. Close the test listener in `finally`.

  Parse each `data: ` frame with `JSON.parse`; assert event types in this order:

  ```ts
  ["run.started", "tool.started", "tool.completed", "text.delta", "run.completed"]
  ```
- [x] **Step 3:** Run `npm test --workspace=@agenter/api` (timeout 60000ms); no API dev server or real MCP/LLM process may run.

### Task 6: Run final checks and update roadmap

**Files:** Update `docs/superpowers/ROADMAP.md`; update this plan's checkboxes only after evidence. No runtime changes unless reviewed fixes require them.

- [x] **Step 1:** Run `npm run typecheck` from repository root (timeout 120000ms).
- [x] **Step 2:** Run `npm run lint` from repository root (timeout 120000ms); record existing warnings and ensure zero new errors.
- [x] **Step 3:** Run `npm test` from repository root (timeout 120000ms); all workspaces must pass without real LLM/MCP.
- [x] **Step 4:** Inspect complete tracked/untracked diff, run `git diff --check`, verify no secrets or SDD artifacts are tracked, and have a broad independent review. Set Phase 7 to Implemented in roadmap only after all acceptance evidence.
- [x] **Step 5:** Report live-runtime limitations honestly; no API/web dev server or real MCP/LLM process is required or claimed.

## Acceptance Criteria

- A provider-neutral model tool call can execute only a registered `safe` tool; local and MCP tools both use the shared ToolRegistry.
- Tool calls are correlated by ID, run sequentially, return serialized results, and precede final assistant text.
- OpenAI-compatible provider parses streamed tool-call fragments and maps request history/definitions without wire types leaking into `agent-core`.
- Unknown, unsafe, malformed, failing and over-limit calls terminate safely; later calls after a failure are skipped.
- One run is finalized; terminal tool-call rows link to it atomically; cumulative usage and event ordering are correct.
- Auto-routing sends `toolsRequired` when safe tools are available; manual provider selection is unchanged.
- No UI, new HTTP endpoint, schema migration, real external LLM/MCP dependency, or provider-specific logic in `AgentRuntime` is introduced.
- Root typecheck, lint (no new errors), tests, diff-check and broad review are evidenced on Node >=24.
