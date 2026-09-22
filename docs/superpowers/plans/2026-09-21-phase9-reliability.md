# Phase 9: Reliability, Security, Observability, and Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the completed functional phases for failures, cancellation, secrets, observability, and repeatable verification.

**Architecture:** Add small boundary utilities rather than spreading retries,
timeouts, and logging through the runtime. Request cancellation flows from the
SSE route to provider fetch and MCP sessions. Structured logs use a redacting
logger at the API boundary; domain packages receive no logger dependency.

**Tech Stack:** Node.js >=24, TypeScript strict, existing workspace tools and
Vitest. Add no dependency unless the plan is amended with an exact version.

**Spec:** `PROMT.md` §§17–20, 21, 23, 24 (Phase 9), and the project `AGENTS.md`.

## Required policies

- Provider requests have a configured timeout and accept `AbortSignal`.
- Client disconnect aborts generation; aborted runs close SSE cleanly and do
  not create an assistant success message.
- Provider unavailable, timeout, invalid key, malformed tool arguments, MCP
  failure, and iteration overflow become safe `run.error` events.
- One MCP server failure never prevents healthy servers or API startup.
- Logs include run id, provider id, model, duration, event/error category, and
  tool/server ids, but never API keys, env values, Authorization headers, or
  raw secrets.
- Tools carry `safe`, `approval-required`, or `disabled` metadata; disabled
  and unauthorized tools cannot execute.

## Tasks

- [ ] **Task 1:** Add failing tests for timeout, cancellation, disconnect, redaction, and
   each required provider/tool/MCP error category.
- [ ] **Task 2:** Implement abort/timeout propagation from messages route through ChatService,
   AgentRuntime, provider adapters, and MCP manager.
- [ ] **Task 3:** Add a small structured logger with deterministic redaction and tests that
   inspect captured records, not console output.
- [ ] **Task 4:** Add security checks for tool policy, argument size/depth, response size, and
   safe serialization of tool results.
- [ ] **Task 5:** Add retry policy only for explicitly transient provider/MCP failures; never
   retry invalid credentials or tool side effects automatically.
- [ ] **Task 6:** Audit migrations/schema, stale plans, README, AGENTS instructions, and
   package versions. Remove dead code without changing public contracts.
- [ ] **Task 7:** Run the full suite on Node >=24, production build/start smoke tests, and
   `git diff --check`; record runtime versions and known warnings.

## Acceptance criteria

- All listed error paths are deterministic, tested, and user-visible as safe
  protocol events.
- Cancellation releases network/process resources and leaves storage coherent.
- Logs and tests demonstrate that secrets are never emitted.
- Full MVP DoD §23 is verified manually and automatically where practical.
- Only after these checks may the roadmap and phase plans be marked complete.
