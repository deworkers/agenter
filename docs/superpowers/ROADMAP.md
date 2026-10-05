# Agenter implementation roadmap

This document is the index for `PROMT.md` and the phase plans. `PROMT.md` is
the product specification; a phase plan narrows it to an independently
testable increment. A plan is not evidence that its code exists.

## Status

| Phase | Scope | Documentation | Code status |
|---|---|---|---|
| 1 | Chat, SQLite, OpenAI-compatible streaming | `plans/2026-09-15-phase1-chat-mvp.md` | Implemented |
| 2 | Provider registry and manual provider selection | `plans/2026-09-16-phase2-provider-registry.md` | Implemented; DONE in plan |
| 3 | Manual/auto provider router | `plans/2026-09-16-phase3-provider-router.md` | Implemented |
| 4 | Filesystem SkillRegistry and skill API | `plans/2026-09-16-phase4-skills.md` | Implemented; metadata listing, creation, editing, disabling and backup-based removal |
| 5 | ToolRegistry and local tool contract | `plans/2026-09-21-phase5-tool-registry.md` | Implemented; API registry is empty by default |
| 6 | MCP stdio/SSE integration | `plans/2026-09-21-phase6-mcp.md` | Implemented; per-server allowlists and settings checks |
| 7 | Agent tool loop | `plans/2026-09-21-phase7-tool-loop.md` | Implemented; provider-neutral bounded loop, safe shared registry execution, atomic call persistence, and SSE lifecycle events |
| 8 | Model, skill, and tool UI | `plans/2026-09-21-phase8-ui.md` | UI implemented; settings/context/mobile follow-ups recorded in `plans/2026-09-28-settings-context-mobile.md`; check original acceptance criteria separately |
| 9 | Reliability, security, observability, and cleanup | `plans/2026-09-21-phase9-reliability.md` | Planned |

User-authorized follow-up (2026-10-01): the API enables an advisory model
self-check after candidate answers. At most two self-check continuations are
allowed in addition to the existing ten tool-call rounds. The self-check cannot
execute tools; incomplete answers are marked in saved text. Provisional text is
reset before continuation so the visible final answer matches storage. This is
documented in the Phase 7 plan and does not complete Phase 9.

User-authorized follow-up (2026-09-29): remove legacy configuration files/loaders,
initialize the single working JSON from a tracked JSON template, and replace
demonstration skills with web research, Context7 docs, complete code delivery,
interface design and review instructions. See [skill catalog](../skills.ru.md)
and the latest follow-up in the 2026-09-28 plan.
This does not implement LLM pre-routing or the remaining Phase 9 scope.

User-authorized follow-up (2026-10-05), issue #2: the composer suggests
`/model`, `/new` and `/compact` while editing a leading slash command.
Suggestions filter by prefix and support mouse/touch, arrows, Enter/Tab and
Escape. Completion only edits the draft; command execution and attachments
retain their existing behavior. See the 2026-09-28 UX follow-up plan.

## Dependency order

Phase 3 depends on Phase 2. Phase 4 depends on Phase 3. Phase 5 defines the
internal tool contract and can be implemented before Phase 6. Phase 6 adapts
MCP tools to Phase 5. Phase 7 depends on both Phase 5 and the provider event
contract. Phase 8 consumes the APIs and events from Phases 3–7. Phase 9 is a
hardening pass after the functional phases, not a substitute for their tests.

Anthropic is a future provider extension and is not required by the current
`PROMT.md` scope. Adding it requires a separate approved plan.

## Cross-phase completion rule

After every phase the application must remain startable. A phase is complete
only when its acceptance criteria, targeted tests, root typecheck, lint, test
suite, and diff review have evidence. Updating a plan's status without that
evidence is not completion.
