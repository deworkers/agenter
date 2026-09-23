# Phase 6: MCP stdio Integration Design

## Goal and scope

Add configured MCP stdio servers to the existing local-first chat backend. The
API discovers their tools and makes them available through the Phase 5
`ToolRegistry` contract. This phase adds server lifecycle and status visibility;
it does not add the model tool loop, MCP UI, remote MCP transports, or a new
execution path around `ToolRegistry`.

## Existing boundaries

- `packages/tools` owns the provider-agnostic tool contract and safe execution
  gate. `packages/agent-core` remains independent of concrete tools and MCP.
- `apps/api` is the composition root. It currently creates an empty local
  registry and exposes skill metadata only; it has no MCP wiring.
- Phase 6 does not change `/api/skills` or make skills executable.

## Architecture

Create `packages/mcp` with an `McpManager` that owns one stdio client session
per configured server. Use the official, exactly pinned MCP SDK. For each
server, connect, discover tool metadata, and adapt each discovered tool to the
Phase 5 `Tool` interface. The manager receives the shared `ToolRegistry` through
its constructor and registers adapters there. Keep server identity in internal
`source` metadata; provider-facing tool names are namespaced consistently as
`<serverId>__<toolName>` to avoid collisions, and arguments do not carry a
caller-controlled server selector. Register adapters into the common registry
so calls use its existing exact-name lookup and safety checks.

Validate the entire discovered tool catalog before registration: each tool
must have a non-empty name, a string description when present (an omitted MCP
description normalizes to `""`), and a plain JSON-compatible object input
schema. If any discovered tool is malformed or collides with an
existing registry name, register none of that server's tools and report that
server as `error`; other servers remain independent.

The operator explicitly trusts every tool exposed by a server they add to
`config/mcp.json`; those discovered MCP tools are therefore marked `safe` and
executable through `ToolRegistry`. The API does not infer trust from model
requests and does not allow unregistered tools to execute.

The API reads `config/mcp.json`, constructs the manager and registry, starts
servers without making one server's failure fatal to API startup, exposes
redacted status and tool metadata at `GET /api/mcp`, and stops sessions during
graceful process shutdown. `agent-core` receives no MCP-specific branch.

## Configuration and failure behavior

Configuration is a JSON object with an `mcpServers` map. Each entry specifies a
process command and optional arguments/environment. Parse raw JSON with
duplicate-key detection so duplicate server IDs cannot silently overwrite one
another. Validate entries before starting processes. Error messages and status
responses must not expose environment values or secrets; environment-backed
configuration remains the source for sensitive values. Expand only whole-value
`${ENV_NAME}` references in `args` and `env`; keep the executable `command` a
literal config value. Pass only explicitly configured `env` overrides to the
SDK; rely on its safe default inherited environment instead of forwarding the
API process's complete environment. Never include resolved values in errors or responses. A
missing config file means no MCP servers; an existing malformed config fails
with an actionable, secret-safe configuration error.

Each configured server transitions independently to `ready` or `error`. A
failed connection or tool discovery leaves other servers usable and does not
prevent API bootstrap. An MCP tool call returns the SDK result through the
common adapter; SDK/tool failures reject with a sanitized error and do not
include secret-bearing process configuration. Shutdown attempts to close every
session even if another session fails to close.

## API surface

`GET /api/mcp` returns server status and available tool metadata only. It must
not return command environment, secret values, or executable configuration.
No MCP management or tool-execution HTTP endpoint is added.

## Security and testing

Only tools registered in `ToolRegistry` can execute, and the Phase 5 `safe`
policy remains enforced. MCP process text is not interpreted as shell commands
from model output; processes originate only from validated application
configuration. Unit tests mock SDK/process behavior, cover configuration
validation (including duplicate JSON keys), healthy/unhealthy server
isolation, tool adaptation and invocation, sanitized failures, status redaction,
and shutdown. The test suite requires no real MCP server or external model API.

## Explicitly out of scope

- Model-generated tool selection, tool-call loop, and tool-call persistence.
- UI for MCP servers or tools.
- HTTP, SSE, or other non-stdio MCP transports.
- Automatic installation or downloading of configured MCP servers.
- Changes to provider routing, skill execution, or `agent-core` MCP awareness.
