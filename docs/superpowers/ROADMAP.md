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
| 4 | Filesystem SkillRegistry and skill metadata API | `plans/2026-09-16-phase4-skills.md` | Implemented; `/api/skills` lists metadata only |
| 5 | ToolRegistry and local tool contract | `plans/2026-09-21-phase5-tool-registry.md` | Implemented; API registry is empty by default |
| 6 | MCP stdio integration | `plans/2026-09-21-phase6-mcp.md` | Implemented; tests/typecheck/lint reviewed |
| 7 | Agent tool loop | `plans/2026-09-21-phase7-tool-loop.md` | Planned |
| 8 | Model, skill, and tool UI | `plans/2026-09-21-phase8-ui.md` | Planned; provider selector exists as an early Phase 2 addition |
| 9 | Reliability, security, observability, and cleanup | `plans/2026-09-21-phase9-reliability.md` | Planned |

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
