# Agent core instructions

## Scope

`packages/agent-core` contains provider-agnostic orchestration and contracts:
`LlmProvider`, `ChatStorage`, `AgentRuntime`, `ContextBuilder`,
`ProviderRegistry`, and the internal `AgentEvent` protocol.

## Rules

- Depend on interfaces, not OpenAI, Anthropic, Express, SQLite, filesystem,
  or network implementations.
- `AgentRuntime` coordinates history, context construction, provider selection,
  streaming events, assistant persistence, and run persistence. Keep provider
  construction outside this package.
- `ContextBuilder` only builds model context; do not mix it with storage,
  provider calls, HTTP concerns, or file loading.
- `ProviderRegistry` stores `LlmProvider` instances and resolves ids/defaults;
  it must not know configuration files or concrete adapter classes.
- Preserve the event protocol: `run.started`, `text.delta`, `text.reset`,
  `run.completed`, and `run.error`. Add tool events only with the approved
  tool-loop plan.
- The runtime has a bounded tool loop, context budget estimates, preview and
  cancellation. Keep all concrete configuration, tokenizer/provider and MCP
  dependencies outside this package. Estimated occupancy and cumulative usage
  are different quantities.
- Optional answer self-check uses the selected provider without tools. Bound
  continuations, keep check output internal, and clear provisional streamed
  text before continuing; the API enables two continuations.
- Compaction uses provider/storage interfaces, no tools, and bounded requests.
  Save a summary checkpoint only after complete, uncancelled generation. Apply
  it to subsequent context while keeping original stored messages unchanged.

## Workflow

Use focused unit tests with fake providers and fake storage. Run:

```text
npm test --workspace=@agenter/agent-core
npm run typecheck --workspace=@agenter/agent-core
```

Then run the root typecheck, lint, and test commands. Test event order,
provider selection, persistence calls, and failure paths explicitly.

## Done when

- Interfaces remain implementation-independent.
- New orchestration behavior has failing-first unit coverage.
- Event order, error semantics, and storage side effects are asserted.
- No framework, network, filesystem, or concrete-provider dependency leaked in.
