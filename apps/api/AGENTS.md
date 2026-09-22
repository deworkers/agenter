# API application instructions

## Scope

`apps/api` is the composition root. It loads configuration, constructs
storage and provider implementations, wires `AgentRuntime` and `ChatService`,
mounts Express routes, and exposes SSE responses.

## Rules

- Keep concrete provider imports in `providerFactory.ts` and bootstrap code.
  `packages/agent-core` must not gain API, filesystem, SQLite, or provider
  implementation dependencies.
- Provider definitions belong in `config/providers.yaml`; secrets use
  `${ENV_NAME}` and `.env`/environment loading. Keep local-only startup
  possible when inactive remote providers lack keys, while the active default
  provider must be fully resolvable.
- Keep configuration validation fail-fast and produce actionable errors.
- Routes validate request shape and translate domain/runtime events into the
  existing `AgentEvent` SSE protocol. Do not expose provider-specific wire
  formats to clients.
- `ChatService` owns API-facing orchestration and forwards provider selection
  through the runtime boundary. Keep persistence behind `ChatStorage`.
- Future router, skills, tools, MCP, and Anthropic work requires the relevant
  phase plan; do not silently introduce it here.

## Workflow

Use the root workflow. For API changes, run targeted tests in `apps/api`, then
from the repository root run:

```text
npm run typecheck --workspace=@agenter/api
npm test --workspace=@agenter/api
npm run typecheck
npm run lint
npm test
```

## Done when

- Configuration, bootstrap, route, and service behavior are tested at the
  changed boundary.
- SSE event ordering and error behavior are preserved.
- No API key appears in source, fixtures, logs, or responses.
- Full workspace checks pass with no new lint errors.
