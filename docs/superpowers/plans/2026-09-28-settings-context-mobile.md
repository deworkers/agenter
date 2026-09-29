# Settings, context budget and mobile web

Approved scope: user requested implementation on 2026-09-28 after discussing
configuration editing, a unified format, context accounting and mobile web.
Use the repository workflow without invoking Superpowers (user instruction).

## Implementation

- [x] Versioned JSON configuration: migrate legacy YAML/JSON on first startup,
  preserve source files, validate before atomic save, keep a backup, expose
  environment variable references rather than resolved credentials.
- [x] Settings API and UI: providers/models, routing, MCP, skill create/edit,
  disable/delete and Markdown preview. Apply changes to future runs; retain
  old runtime resources until its active runs finish. Test connections without
  sending chat history. No new packages or provider implementations.
- [x] Context estimate with system/skill/tools/history/result breakdown,
  configured window and output reserve. Reject overflow before sending and
  allow explicitly omitting oldest history. Separate per-request occupancy
  from cumulative token usage. Estimates are not exact tokenizer counts.
- [x] Cancellation and timeouts, terminal stream checks, persisted tool/run
  metadata on reopen. Existing database remains readable through additive
  migrations only. No automatic retries of tool side effects.
- [x] Mobile drawer for history, full-screen settings/editors, bottom capability
  panel (superseded by sidebar switches in the follow-up below), keyboard-aware
  layout, conditional autoscroll and copy actions.
- [x] Update configuration docs and stale agent instructions, run root
  typecheck/lint/tests, production web build and browser verification.

## Acceptance

Settings survive restart, invalid saves leave the old configuration intact,
secrets do not appear in settings responses, skill edits survive registry scan,
context overflow prevents provider requests, stop aborts downstream work, and
saved tool activity/duration reappears. Verify at 390px and desktop. Real mobile
keyboard behavior requires a physical-device check; report that limitation.

## Verification (2026-09-28)

- Node v24.19.0; root `npm run typecheck` and `npm run lint` passed.
- Root `npm test`: 219 tests passed across eight workspaces.
- `npm run build --workspace=@agenter/web` passed; `git diff --check` clean.
- Local running app: settings load/save and catalog refresh, local model and
  MCP connection checks, skill editor/preview with scripts/event handlers
  removed (preview changes discarded), context breakdown, mobile drawer and
  full-screen settings at 390 × 844, saved conversation metadata and code copy.
- Desktop long history: page and composer constrained to viewport; history and
  messages scroll independently. Temporary mobile viewport override reset.

Context estimates use text size, not the selected model's tokenizer. No real
generation or external tool side effect was required for browser verification;
stream cancellation/overflow/persistence use deterministic automated tests.
Physical mobile keyboard behavior remains unverified. Interrupted answer text
is not persisted; the failed run and completed tool records remain available.
Remaining Phase 9 logging/retry/audit work is outside this approved scope.

## Approved UX follow-up (2026-09-28)

User requested slash commands, a corrected occupancy bar, stable context
statistics while typing, separate creation dialogs, and sidebar capability
switches. The user explicitly selected model-generated summaries for `/compact`.

- `/model [ID|auto]` selects a model or opens the existing picker; `/new` creates
  a chat. Commands are consumed locally without creating chat messages.
- `/compact` calls the selected model without tools, using bounded batches when
  required; writes a separate SQLite checkpoint only after complete generation.
  Subsequent context includes that summary and later messages; original history
  remains visible. Cancellation/error preserves the previous checkpoint.
- Progress shows occupied tokens, excluding the output reserve. Context preview
  retains its last estimate and marks refresh/error without hiding the block.
- New model/MCP dialogs validate complete entries and stage them before the
  settings save. Sidebar contains skill and MCP toggles; editing remains in settings.

Verify with targeted regression tests, root checks, production build, desktop
and mobile browser checks. Real model smoke uses fictional data in memory only.

Follow-up verified on Node v24.19.0: root typecheck/lint passed, 232 tests
passed, production web build passed, and `git diff --check` clean. Browser
verified `/model ID`, picker command, staged creation/cancel, occupancy value
14/64000, unchanged composer position during refresh, and mobile sidebar
switches at 390px. Test resource drafts were discarded; viewport reset.
Local-model memory smoke preserved 24 messages and reduced estimated history
2724 → 458 tokens; the next preview used the persisted summary. SQLite tests
also reopen the database to verify checkpoint persistence and cascade cleanup.
Physical mobile keyboard behavior and full Phase 9 work remain outside this check.

## Approved text-document follow-up (2026-09-28)

User requested text file attachments, separate text-only clipboard cards,
and generated Markdown/HTML documents with download/browser actions.
Implementation and acceptance are described in `docs/text-files.ru.md`.
Scope extends this chat UI and context/storage boundaries; no server filesystem
access, binary uploads, additional provider or tool execution is introduced.

## Response format correction (2026-09-29)

User reported incorrect response-format delivery and requested inspection of
recent SQLite chats. They showed file-path reports without document content,
an empty successful file response, and skill delivery instructions following
the selected format instructions.

- Place a detailed output contract after skill instructions in the same leading
  system message, while keeping stored context/preview estimates consistent.
- Deliver one complete fenced HTML/Markdown document in the final response;
  avoid imaginary paths, writing local files through search tools, and external
  dependencies unsupported by HTML preview.
- Reject empty completed file responses with an error run and retained usage.
- Never export prose as HTML; preserve raw Markdown including code examples,
  reject unfinished delivery wrappers, and show a missing-format warning.
- Preserve the original database, skills, chats and default text response behavior.

Verify regression tests, root typecheck/lint/tests, web build, and a fictional
local-model smoke without persisting a chat.

## Approved configuration and skill follow-up (2026-09-29)

User authorized legacy cleanup and practical skills for web search, Context7
documentation and complete code delivery with interface design. LLM pre-routing
is deferred; the existing provider rules remain unchanged.

- Remove providers.yaml, routing.yaml, mcp.json and unused legacy loaders/dependencies.
  Existing config/agenter.json remains authoritative; a clean install initializes
  it from tracked agenter.example.json. Invalid existing JSON is never overwritten.
  The migration described earlier in this plan is historical and superseded.
- Replace research/code-review scaffolds; adapt the user-provided claude-design
  instructions with a local backup, and add context7-docs and one-pass-code.
  Instructions require real sources, available tools and complete delivery in
  the selected response format, without imaginary filesystem/test capabilities.
- Include an optional disabled Context7 stdio recipe in the clean-install template.
  Add Context7 to the current local settings without replacing other models/MCP.
  Allow only resolve-library-id and query-docs. No key is required for the smoke.
- Update configuration and skill documentation and verify JSON initialization,
  schema validation, actual MCP lookup, skill loading and root checks.

Initial regression run failed on the new template/legacy expectations (2 tests),
then passed after implementation. Context7 v4.1.1 connection/catalog and two
read-only live calls resolved Vue and returned official watcher-cleanup docs.
No chat or database write was needed for this check.

Verification: Node v24.19.0; root `npm run typecheck` and `npm run lint` passed.
All 227 tests passed with
`npm run test --workspaces --if-present -- --pool=threads --maxWorkers=1 --configLoader=native`.
Plain `npm test` fails to spawn fork workers with EPERM in this environment.
Production web build passed with `npm run build --workspace=@agenter/web -- --configLoader=native`.
Live API listed all five skills and previewed their instructions with nonzero
skill token estimates. Context7 status is ready; git diff --check is clean.
This verifies catalog/context wiring and MCP documentation access, not reliable
obedience to every instruction by every model.
