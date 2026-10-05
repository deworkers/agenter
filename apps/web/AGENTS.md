# Web application instructions

## Scope

`apps/web` is the Vue 3 + Vite client. Components render state; API calls and
SSE parsing belong in `src/api/` and composables.

## Rules

- `AuthApp.vue` restores the session before mounting the chat app; changing
  users remounts `App.vue`. Keep authentication requests in `api/client.ts` and
  state in `useAuth`; handle 401 for JSON and SSE. Browser chat preferences must
  include the authenticated user ID. Logout/unmount aborts the active client run.
- Keep the Vite `/api` proxy as an object with `changeOrigin: false`: the API
  validates the browser Origin against the original Host, including the port.
  Cover proxy behavior with a real HTTP regression test when changing it.

- Use Vue 3 Composition API and `<script setup>` for components.
- Keep HTTP and streaming transport logic in `src/api/client.ts` and stateful
  behavior in composables such as `useChats` and `useProviders`.
- Components consume the internal `AgentEvent` protocol and must not parse
  OpenAI-compatible or other provider-specific responses.
- Preserve provider selection behavior and the `{ providers,
  defaultProviderId }` catalog shape.
- Keep rendering safe. Avoid introducing `v-html`; if trusted markdown needs
  rendering, define and test an explicit sanitization boundary first.
- Settings, skills/MCP editing, context accounting and responsive drawers are
  covered by the approved 2026-09-28 plan. Keep transport/state in API and
  composables; render Markdown only through the DOMPurify boundary.
- Slash commands are consumed before sending a prompt. Keep the last context
  estimate visible while refreshing; the progress bar excludes output reserve.
  Sidebar capability controls only select skills/MCP; settings dialogs own
  resource creation/editing. `/compact` uses its dedicated API and must preserve
  the displayed conversation and draft on failure/cancellation.

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
