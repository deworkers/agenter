# Agenter — agent instructions

## Scope

This repository is a Node.js/TypeScript monorepo for a local-first LLM chat.
The backend is Express + SQLite, the frontend is Vue 3 + Vite, and packages
provide the agent core, storage boundary, OpenAI-compatible adapter, skills,
tools, and MCP integration.

Read `PROMT.md` for product requirements and the relevant plan in
`docs/superpowers/plans/` before implementing a phase. Verify behavior in code:
plans describe scope, not proof of implementation. Phases 1–7 have code for
chat and streaming, provider registry and routing, filesystem-backed skills,
ToolRegistry, MCP integration, and a bounded model tool loop. The web app also
has provider and skill selection, skill creation, MCP server selection, and
tool-call display. Check the Phase 8 acceptance criteria before treating its UI
work as complete. Phase 9 reliability work remains planned; verify individual
capabilities in code. Confirm the relevant plan is approved before implementing
a later phase.

Current boundaries: `apps/api` wires providers, storage, skills, a local tool
registry that is empty by default, and configured MCP servers. Local
`config/agenter.json` is the active versioned configuration; first startup
initializes it from tracked `config/agenter.example.json` only when absent.
Its `systemPrompt` is editable in settings and applies to future runs; older
configurations without it retain the original default instruction.
Legacy configuration files and loaders have been removed. Settings API
updates apply to future runs; active runtime resources remain until their runs
finish. See `docs/configuration.ru.md` and the approved
`docs/superpowers/plans/2026-09-28-settings-context-mobile.md` for this scope.
`packages/mcp` connects over stdio or SSE and registers
discovered tools in the shared `ToolRegistry`. `GET /api/mcp` exposes server
status and tool metadata. `GET /api/skills` lists metadata; `POST /api/skills`
creates filesystem-backed skills; GET/PUT/DELETE by id support editing and
backup-based removal. Selected skill instructions are passed into a
chat turn. The message route accepts selected MCP server IDs, and
`AgentRuntime` runs a bounded model tool loop through the registry. There is no
tool execution HTTP endpoint. Registry execution rejects unknown and non-`safe`
tools. MCP allowlists control which discovered tools are safe. Context estimates
reserve output tokens and enforce the configured window before provider calls.
The API enables a separate no-tools answer self-check with at most two
continuations. Provisional text is reset before continuation; blocked or
unverified answers carry an incomplete note. The check is advisory.
Cancellation flows through provider fetch and MCP calls. Storage restores run
metadata and tool activity through an additive assistant-message link migration.
Chat commands are handled locally by the web client. `/compact` uses the chosen
model without tools and saves a separate SQLite context checkpoint; original
messages remain intact. Runtime history applies summaries through the
`ContextCheckpointStorage` interface. See the approved UX follow-up in the
same 2026-09-28 plan. Capability switches live in the sidebar; resource editing
and creation dialogs live in settings.
Bundled skills cover web research, Context7 documentation, complete code delivery,
code review, video transcripts, bug diagnosis and text editing; see
`docs/skills.ru.md`. Selecting a skill also selects its linked ready MCP servers;
manual MCP selection and server allowlists remain independent. Keep delivery
instructions compatible with the selected response format and actual tools.
Keep `packages/agent-core` independent of concrete tools/providers.

## Rules

- Use Node.js >=24; the project uses built-in `node:sqlite`.
- Preserve strict TypeScript settings and the existing npm workspace layout.
- Keep dependencies behind interfaces and keep `agent-core` provider/storage
  agnostic.
- Keep secrets in environment variables; never commit or log API keys.
- Prefer the smallest change that satisfies the current phase. Do not add
  speculative abstractions or implement a later phase opportunistically.
- Follow existing package names, file naming, ESM imports, and test style.

## Workflow

1. Inspect the tree, relevant package manifest, current implementation, and
   the applicable plan.
2. State the files and behavior to change before editing.
3. For behavior changes, write a focused failing test first, then implement
   the minimum code and refactor only while tests remain green.
4. Run targeted checks, then from the repository root run:
   `npm run typecheck`, `npm run lint`, and `npm test`.
5. After every change, check whether affected documentation still matches the
   code and behavior. Update stale README, roadmap, plans, and agent
   instructions in the same change where applicable.
6. Review `git diff`, `git diff --check`, and the final status. Preserve
   unrelated working-tree changes.

## Done when

- The requested behavior is covered by tests and the applicable plan criteria.
- Typecheck and tests pass; lint has no new errors.
- Affected documentation has been checked and updated where needed.
- No secrets, unrelated edits, or unplanned phase work are present.
- The final report includes commands, results, and any runtime limitation.
