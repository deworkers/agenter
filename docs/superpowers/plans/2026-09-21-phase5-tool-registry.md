# Phase 5: Tool Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one provider-agnostic registry for safe local tools without yet implementing MCP or the model tool loop.

**Architecture:** `ToolRegistry` lives in `packages/tools` and stores `Tool` objects behind a small interface. `agent-core` receives tool descriptions and execution through interfaces only; it does not import `packages/tools`. The API composition root registers explicitly enabled local tools. Tool metadata includes a future-facing safety policy, but Phase 5 never executes unregistered tools.

**Tech Stack:** Node.js >=24, TypeScript strict, npm workspaces, Vitest. No new dependency is required.

**Spec:** `PROMT.md` §§3, 9, 10, 15, 19, 20, 24 (Phase 5).

## Global constraints

- `Tool.execute(args)` is asynchronous and receives `unknown`; each tool validates its own arguments.
- Registry lookup is by exact tool name and never falls back to arbitrary execution.
- Tool descriptions are data for providers; they are not executable instructions.
- Tool execution never shells out directly from model text.
- No MCP lifecycle, tool loop, or UI is implemented in this phase.

## File structure

```text
packages/tools/
  package.json
  tsconfig.json
  src/types.ts
  src/ToolRegistry.ts
  src/ToolRegistry.test.ts
  src/index.ts
apps/api/src/localTools.ts
apps/api/src/localTools.test.ts
apps/api/src/index.ts
```

## Interfaces

```ts
export type ToolSafety = "safe" | "approval-required" | "disabled";

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  safety: ToolSafety;
  source?: { kind: "local" | "mcp"; serverId?: string };
  execute(args: unknown): Promise<unknown>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  list(): Tool[];
  get(name: string): Tool | undefined;
  execute(name: string, args: unknown): Promise<unknown>;
}
```

## Tasks

- [ ] **Task 1:** Add failing tests for registration, duplicate-name rejection, deterministic
   listing, unknown-tool rejection, disabled-tool rejection, and successful
   execution.
- [ ] **Task 2:** Implement `ToolRegistry` with a `Map`, exact-name lookup, and errors that
   identify the requested tool without echoing secrets.
- [ ] **Task 3:** Add one deliberately small local fixture tool used only in tests (for
   example, `echo`) and an API composition helper that registers explicitly
   enabled tools.
- [ ] **Task 4:** Add tests proving `agent-core` can consume a plain tool description type
   without importing the concrete registry. Do not add runtime integration yet.
- [ ] **Task 5:** Run targeted package tests, root typecheck/lint/test, and inspect the diff.

## Acceptance criteria

- The registry exposes only registered tools and rejects unknown/disabled ones.
- Tool metadata includes `safe`, `approval-required`, and `disabled` states.
- No model response can execute a tool through an unregistered name.
- No MCP, tool loop, or frontend behavior is claimed by this phase.
