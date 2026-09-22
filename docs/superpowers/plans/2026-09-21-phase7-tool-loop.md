# Phase 7: Agent Tool Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `AgentRuntime` execute registered tool calls, append results to context, and continue the model conversation until a final answer or a bounded failure.

**Architecture:** Extend the provider-neutral event contract with tool-call events and a provider-neutral tool request/result representation. `AgentRuntime` owns orchestration and the iteration limit; `ToolRegistry` owns lookup, safety policy, argument validation, and execution. The provider adapter only translates wire-format tool calls to/from the shared contract.

**Tech Stack:** Node.js >=24, TypeScript strict, existing provider/storage/tools/MCP packages, Vitest.

**Spec:** `PROMT.md` §§3, 9, 10, 15, 17, 19, 20, 24 (Phase 7).

## Event and request contract

```ts
export type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type ToolResultMessage = {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
};

export type AssistantToolCallMessage = {
  role: "assistant";
  content: null;
  toolCalls: ToolCall[];
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type LlmRequest = {
  messages: Array<ChatMessage | AssistantToolCallMessage | ToolResultMessage>;
  tools?: ToolDefinition[];
};

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
```

`tool.call.id` is the correlation key. The loop must first append an
`AssistantToolCallMessage` containing all calls emitted by one assistant turn,
then append one `ToolResultMessage` with the same `toolCallId` per execution
before the next provider call. The provider adapter maps these neutral
messages to its wire-specific assistant/tool result format. `ChatMessage` and
`ToolDefinition` are the existing neutral types or their explicit extensions
in `agent-core`; no provider payload type crosses this boundary.

Set `MAX_TOOL_ITERATIONS = 10` in the runtime boundary and make it injectable
in tests. A disabled or approval-required tool produces a run error unless a
future approval mechanism explicitly authorizes it.

## Tasks

- [ ] **Task 1:** Add failing provider-adapter tests for tool-call deltas and tool result
   messages while preserving existing text streaming behavior.
- [ ] **Task 2:** Add failing `AgentRuntime` tests for one tool call followed by final text,
   multiple calls, tool errors, malformed arguments, and iteration overflow.
- [ ] **Task 3:** Implement the loop: emit `tool.started`, execute the registry, emit
   `tool.completed`, append a tool result message, and request the next model
   turn. Persist the final assistant response and run exactly once.
- [ ] **Task 4:** Persist tool-call records in the existing `tool_calls` table through a
   storage interface extension; keep partial/error runs consistent.
- [ ] **Task 5:** Add end-to-end mocked-provider tests through `ChatService` and SSE.
- [ ] **Task 6:** Run all package and root checks; verify no infinite loop is possible.

## Acceptance criteria

- A model can call a registered local or MCP-backed tool and receive its result.
- Final text follows the tool result and is streamed through the shared event
  protocol.
- Unknown, disabled, malformed, failing, and looping calls terminate safely.
- The iteration limit is tested and configurable; no real LLM is required.
