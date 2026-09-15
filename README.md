# Agenter

Local-first LLM agent chat. Backend: Node.js/Express/SQLite. Frontend: Vue 3/Vite.
See `docs/superpowers/plans/` for the implementation plan.

## Requirements

- Node.js 24 LTS or newer (uses the built-in `node:sqlite` module)
- An OpenAI-compatible LLM endpoint reachable from this machine (LM Studio, Ollama, vLLM, or OpenAI itself)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `PROVIDER_BASE_URL` and `PROVIDER_MODEL` to point at your endpoint
3. In one terminal: `npm run dev:api`
4. In another terminal: `npm run dev:web`
5. Open the URL Vite prints (typically `http://localhost:5173`)

## Verification

Run the full verification suite from the repo root:

```bash
npm install
npm run typecheck
npm run lint
npm run test
```

Expected: all workspaces typecheck cleanly, lint reports zero errors, and every test suite passes.
