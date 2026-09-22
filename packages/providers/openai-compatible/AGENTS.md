# OpenAI-compatible provider instructions

## Scope

This package adapts an OpenAI-compatible `/chat/completions` endpoint to the
`LlmProvider` interface. It supports arbitrary `baseUrl`, `apiKey`, and
`model` values so it can target local servers, Ollama-compatible endpoints,
vLLM, LM Studio, or hosted compatible APIs.

## Rules

- Keep this adapter responsible for HTTP request construction, response
  decoding, and provider-specific SSE parsing only.
- Emit the shared `LlmEvent` shape; do not expose raw provider payloads to
  `AgentRuntime` or the frontend.
- Preserve streaming behavior, `[DONE]` handling, text deltas, usage, and
  provider error conversion.
- Use `fetch` injection/mocking in tests. Tests must not require a real model,
  network, or API key.
- Never log or include API keys in errors, snapshots, fixtures, or responses.
- Registry construction, routing, persistence, and HTTP route concerns belong
  outside this package.
- Anthropic and tool-call adapter behavior are future extensions unless an
  approved phase plan adds them.

## Workflow

For adapter changes, test successful streaming, malformed/truncated streams,
non-2xx responses, network failures, and usage mapping as relevant:

```text
npm test --workspace=@agenter/provider-openai-compatible
npm run typecheck --workspace=@agenter/provider-openai-compatible
```

Then run the root checks and inspect the diff for leaked credentials.

## Done when

- The adapter satisfies `LlmProvider` without provider-specific leakage.
- New wire behavior has mocked-fetch tests.
- Error and stream termination behavior is deterministic.
- Typecheck, tests, and the root lint check pass without new errors.
