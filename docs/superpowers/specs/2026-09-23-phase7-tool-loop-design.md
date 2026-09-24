# Phase 7: Agent Tool Loop Design

## Goal and scope

Let the model request registered tools, execute them through the existing
Phase 5/6 `ToolRegistry`, receive results in the next model request, and stream
a final response. Provider-specific serialization stays in the provider
adapter; the loop remains bounded and provider-agnostic in `AgentRuntime`.

In scope: provider-neutral request/event/history contracts, OpenAI-compatible
stream and message translation, runtime orchestration, tool-call persistence
through `ChatStorage` and the existing SQLite `tool_calls` table, SSE event
propagation, and focused tests. No new public HTTP endpoint or schema migration
is introduced.

Out of scope: tool-call UI (Phase 8), manual approval UI, Anthropic, new
transports, RAG/memory, retries, cancellation, stale-run recovery, and broad
reliability hardening (Phase 9).

## Existing boundaries

- `AgentRuntime` owns context, provider choice, streaming orchestration, and run
  persistence. `ChatService` forwards message options; the messages route
  serializes the shared event stream as SSE.
- `packages/agent-core` stays independent of Express, SQLite, MCP SDK,
  `packages/tools`, and concrete providers. It consumes a neutral interface for
  tool definitions and execution.
- The OpenAI-compatible adapter currently streams text only and reports
  `supportsTools() === false`; Phase 7 adds its wire translation.
- `ToolRegistry` owns exact-name lookup, safety enforcement, and execution. The
  API composes it with the agent runtime.
- SQLite already has `tool_calls` linked to `runs`; `ChatStorage` has no
  tool-call persistence method yet.

## Architecture

`AgentRuntime` receives an agent-tool interface that lists provider-neutral
definitions and executes a named tool with `unknown` arguments. The API adapter
exposes only definitions for `safe` tools; every invocation delegates to the
shared registry, whose runtime safety gate remains authoritative. No
`packages/tools` type enters `agent-core`.

Extend `LlmRequest` with a union of normal chat messages, an assistant tool-call
message, and correlated tool-result messages, plus optional tool definitions.
Extend `LlmEvent` with complete `tool.call` values. The OpenAI-compatible
adapter assembles streamed tool-call fragments by index, validates completed
IDs/names and JSON-object arguments, and maps the complete calls to the neutral
event. It maps assistant tool-call history, tool results, and definitions to
the provider's wire format. No provider payload type crosses into
`AgentRuntime`.

Add `tool.started` and `tool.completed` variants to `AgentEvent`; the existing
SSE route forwards them unchanged. The runtime emits `run.started` once,
streams text deltas, collects one assistant response's calls, appends that
assistant turn, executes calls sequentially in model order, appends correlated
tool results, and requests the next model turn. Calls within a turn are not
started until the provider has completed and validated the full call set.

## Provider selection and tool availability

In `auto` mode, when at least one `safe` tool is available, the runtime sets the
existing `RoutingContext.toolsRequired` signal so `ProviderRouter` selects its
configured reasoning route. Explicit `providerId`/manual selection is
unchanged; the router class itself does not change. A selected provider must
advertise tool support before tool definitions are sent. The OpenAI-compatible
adapter reports tool support after Phase 7; a tool call from an unsupported
provider fails safely.

## Tool-call and message contracts

```ts
export type ToolCall = { id: string; name: string; arguments: unknown };

export type AssistantToolCallMessage = {
  role: "assistant";
  content: string | null;
  toolCalls: ToolCall[];
};

export type ToolResultMessage = {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
};

export type LlmEvent =
  | { type: "text.delta"; text: string }
  | { type: "tool.call"; call: ToolCall }
  | { type: "done"; usage?: TokenUsage }
  | { type: "error"; message: string };
```

The call ID is the correlation key: one assistant tool-call message contains
all calls in that model response, then each successful `ToolResultMessage`
uses the same ID/name. Provider-generated IDs must be non-empty and unique
within the response. The assistant message preserves any text emitted in the
same response, or uses `null` if it emitted none. Tool result content and stored
arguments/results are JSON strings. Results must be JSON-serializable; a
non-serializable result becomes a sanitized tool failure rather than breaking
SSE or corrupting context.

## Loop bounds and failures

Use `MAX_TOOL_ITERATIONS = 10`, injectable in tests. An iteration is one
assistant response containing one or more tool calls. Up to ten such responses
may be executed; after the tenth result set, permit one provider request for a
final answer. If that response requests an eleventh tool-call iteration, do not
execute it; terminate with `run.error` and mark its calls skipped.

Malformed streamed JSON, missing/duplicate IDs, empty names, or
non-object arguments fail before tool execution. Unknown, disabled,
approval-required, and failing tools terminate the run safely. On the first
execution failure within a response, stop and do not execute later calls from
that response; record the failed call and mark later calls skipped. A provider
iterator that ends without `done` or an explicit error is incomplete: execute
none of its collected calls, mark them skipped, and fail the run. If terminal
storage fails, emit a fixed sanitized `run.error`; the final assistant must
remain unpersisted. Error text must not contain API keys, environment values,
raw configuration, or untrusted tool result bodies. No model response can
bypass registry lookup or safety checks.

## Persistence semantics

Keep ordinary chat history concise: persist the user message as today and the
final assistant answer once; assistant-call and tool-result protocol messages
remain in the in-memory provider context. Persist detailed invocations in the
existing `tool_calls` table through a new `ChatStorage` interface extension,
associated with one terminal run. One terminal `completeRun` operation
atomically writes the run and all accumulated call records; on success it also
writes the final assistant message and updates the chat timestamp in that same
transaction, while error runs write no assistant message. Store call statuses
`success`, `error`, or `skipped`, and usage accumulated across all provider
rounds. The chosen completion-time persistence strategy avoids adding a
running-status/update lifecycle, but an abrupt process crash may lose an
unfinished run and buffered calls; crash recovery remains Phase 9 scope.

## Testing

- Provider adapter tests mock `fetch`: fragmented/multiple tool-call deltas,
  serialized definitions and assistant/tool history, preserved text streaming,
  aggregate usage, malformed/truncated streams, non-2xx and network failures.
- Runtime tests use fake provider/tool/storage to assert event order, one and
  multiple sequential calls, ID correlation, final text after results, exactly
  one terminal run, persisted tool-call records, usage aggregation, unknown,
  unsafe, malformed and failing calls, skipped later calls, and iteration
  exhaustion.
- SQLite tests use isolated/in-memory databases to verify tool-call records and
  their run association.
- Mocked integration tests cover `ChatService` and the messages SSE route. No
  real LLM or MCP process is required.
- Final checks: targeted package checks and root typecheck/lint/test on Node
  >=24. No API development server or watch mode is required for unit tests.

## Explicitly out of scope

- Rendering tool activity/results in `apps/web` (Phase 8).
- Approval workflow for `approval-required` tools.
- MCP setup/status and server lifecycle changes (Phase 6 is complete).
- Cancellation, retry policy, recovery for interrupted runs and broader
  structured logging (Phase 9).
- Provider-specific branches in `AgentRuntime` or concrete dependencies in
  `agent-core`.
