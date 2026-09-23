# Agenter — agent instructions

## Scope

This repository is a Node.js/TypeScript monorepo for a local-first LLM chat.
The backend is Express + SQLite, the frontend is Vue 3 + Vite, and packages
provide the agent core, storage boundary, and OpenAI-compatible adapter.

Read `PROMT.md` for product requirements and the relevant plan in
`docs/superpowers/plans/` before implementing a phase. Verify behavior in code:
plans describe scope, not proof of implementation. Phases 2–5 are implemented
(provider registry, rule-based router, filesystem-backed skills, and safe local
ToolRegistry). Phases 6–9 have plans but are not implemented; do not assume MCP,
the model tool loop, remaining UI, or reliability work exists. Confirm the
relevant plan is approved before implementing a later phase.

Current boundaries: `apps/api` wires providers, storage, skills, and an empty
local tool registry. `GET /api/skills` lists skill metadata; it does not execute
skills. Tools are registered only when explicitly enabled; registry execution
rejects unknown and non-`safe` tools. No tool HTTP endpoint or model tool loop
exists. Keep `packages/agent-core` independent of concrete tools/providers.

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
5. Review `git diff`, `git diff --check`, and the final status. Preserve
   unrelated working-tree changes.

## Done when

- The requested behavior is covered by tests and the applicable plan criteria.
- Typecheck and tests pass; lint has no new errors.
- No secrets, unrelated edits, or unplanned phase work are present.
- The final report includes commands, results, and any runtime limitation.
