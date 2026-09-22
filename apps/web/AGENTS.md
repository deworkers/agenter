# Web application instructions

## Scope

`apps/web` is the Vue 3 + Vite client. Components render state; API calls and
SSE parsing belong in `src/api/` and composables.

## Rules

- Use Vue 3 Composition API and `<script setup>` for components.
- Keep HTTP and streaming transport logic in `src/api/client.ts` and stateful
  behavior in composables such as `useChats` and `useProviders`.
- Components consume the internal `AgentEvent` protocol and must not parse
  OpenAI-compatible or other provider-specific responses.
- Preserve provider selection behavior and the `{ providers,
  defaultProviderId }` catalog shape.
- Keep rendering safe. Avoid introducing `v-html`; if trusted markdown needs
  rendering, define and test an explicit sanitization boundary first.
- Skills, tools, MCP panels, and richer model UX are later-phase work unless
  their plan is explicitly active.

## Workflow

Use the root workflow. For web changes, run:

```text
npm run typecheck --workspace=@agenter/web
npm test --workspace=@agenter/web
```

Then run the full root checks before completion. Add composable/client tests
for state transitions, transport errors, and SSE event handling.

## Done when

- The UI behavior is covered at the composable or client boundary.
- Components remain thin and use existing state/transport abstractions.
- Typecheck and web tests pass, with no new lint warnings or errors.
