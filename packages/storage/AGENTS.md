# Storage package instructions

## Scope

`packages/storage` implements the `ChatStorage` boundary with SQLite using
Node's built-in `node:sqlite`. The schema and persistence details live here;
the runtime consumes only the interface from `agent-core`.

## Rules

- Keep SQL, database handles, schema creation, and row mapping inside this
  package. Do not import storage implementation classes into `agent-core`.
- Preserve the current chats, messages, runs, and tool-call schema contracts.
  Schema changes require an explicit migration/backward-compatibility plan.
- Map nullable database values to the domain types consistently.
- Keep provider/model metadata persisted with messages and runs where the
  domain contract requires it. Never persist API keys or environment secrets.
- Use deterministic, isolated test databases or in-memory databases in tests;
  never depend on a developer's real database.

## Workflow

For persistence changes, add a focused storage test first and cover create,
read, update/touch, delete/cascade, and restart/persistence behavior as
applicable:

```text
npm test --workspace=@agenter/storage
npm run typecheck --workspace=@agenter/storage
```

Finish with the root checks. Account for the Node `node:sqlite` requirement
when reporting verification results.

## Done when

- Schema and repository behavior are covered by tests.
- `agent-core` still sees only `ChatStorage`.
- No secret data is written or logged.
- Persistence tests pass on the supported Node version.
