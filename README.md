# Agenter

Local-first LLM agent chat. Backend: Node.js/Express/SQLite. Frontend: Vue 3/Vite.
See `docs/superpowers/plans/` for the implementation plan.

## Requirements

- Node.js 24 LTS or newer (uses the built-in `node:sqlite` module)
- An OpenAI-compatible LLM endpoint reachable from this machine (LM Studio, Ollama, vLLM, or OpenAI itself)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values below
3. In one terminal: `npm run dev:api`
4. In another terminal: `npm run dev:web`
5. Open the URL Vite prints (typically `http://localhost:5173`)

### Environment variables

| Variable          | Purpose                                                                                          | Example / Default                              |
| ----------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `PORT`            | HTTP port for the API server                                                                     | `3000`                                         |
| `DB_PATH`         | Path to the SQLite database file                                                                  | `./data/agenter.db`                            |
| `TOOKEN_CLUB_API_KEY` | Required when using a remote OpenAI-compatible provider (e.g. Tooken Club). Set via `.env` | Leave blank for local-only mode                |

When running locally only, set no API key and point the default provider at your local endpoint.
For remote providers, add `TOOKEN_CLUB_API_KEY=<your-key>` to `.env` and configure the provider in `config/providers.yaml`.

### Provider configuration

Providers are defined in `config/providers.yaml`. The file supports `${ENV_VAR}` interpolation: any value matching the pattern `\${KEY}` is resolved against the environment at load time. This lets you keep secrets out of version control while still referencing them from YAML — for example `apiKey: ${TOOKEN_CLUB_API_KEY}` resolves to the value of the env var.

### Local-only mode (no remote API key)

```yaml
# config/providers.yaml
defaultProvider: local
providers:
  local:
    type: openai-compatible
    baseUrl: http://localhost:8080/v1
    apiKey: local
    model: qwen3
```

### Remote provider (e.g. Tooken Club)

```yaml
# config/providers.yaml
defaultProvider: api-smart
providers:
  api-smart:
    type: openai-compatible
    baseUrl: https://tooken.club/v1
    apiKey: ${TOOKEN_CLUB_API_KEY}
    model: gpt-5.6-sol
```

## Verification

Run the full verification suite from the repo root:

```bash
npm install
npm run typecheck
npm run lint
npm run test
```

Expected: all workspaces typecheck cleanly, lint reports zero errors, and every test suite passes.
