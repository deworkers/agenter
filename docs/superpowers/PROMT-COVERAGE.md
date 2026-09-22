# PROMT.md coverage matrix

This matrix is the documentation index for the product specification. It
distinguishes implemented code, an executable plan, and an unplanned gap.
Check the linked plan and the repository before changing a status.

| PROMT section | Requirement | Source of truth | Status |
|---|---|---|---|
| §1 | Node/TS/Express/SQLite/SSE/Vue/Vite/MCP/provider stack | `AGENTS.md`, Phase 1, Phase 6 | Partial: current implementation uses Node SQLite and OpenAI-compatible provider; MCP is planned |
| §2 | Chat, history, streaming, model, manual model, skills, MCP | Phase 1, Phase 2, Phase 4, Phase 8 | Partial: chat/manual provider exists; skills/MCP/tool UX planned |
| §3 | ChatService, runtime, context, router, registries, MCP, storage boundaries | Phase 1–7 plans; component `AGENTS.md` files | Partial: implemented components are documented; future boundaries are planned |
| §4 | Provider interface and OpenAI-compatible adapter | Phase 1, Phase 2, openai-compatible `AGENTS.md` | Implemented for OpenAI-compatible providers; Anthropic is future scope |
| §5 | ProviderRegistry, external YAML config, env secrets | Phase 2 plan and code | Implemented; Phase 2 marked DONE |
| §6 | Manual/auto ProviderRouter and rule-based TaskType routing | Phase 3 plan | Planned; not evidence of code |
| §7 | Filesystem SkillRegistry, metadata, lazy content, manual selection | Phase 4 plan | Planned; not evidence of code |
| §8 | MCP stdio, server lifecycle, tool discovery/execution | Phase 6 plan | Planned |
| §9 | Unified ToolRegistry and local/MCP tool contract | Phase 5 and Phase 6 plans | Planned |
| §10 | Runtime orchestration and bounded tool loop | Phase 7 plan | Planned |
| §11 | ContextBuilder and future context extensions | Phase 1, Phase 4, Phase 7 plans | ContextBuilder implemented; skill/tool extensions planned |
| §12 | SQLite chats/messages/runs/tool_calls schema | Phase 1 and Phase 7 plans | Core schema implemented; tool-call writes planned |
| §13 | Chat/provider/skills/MCP/message endpoints | Phase 1, Phase 2, Phase 4, Phase 6 plans | Chat/providers implemented; skills/MCP planned |
| §14 | Model/skill selectors and tool-call UI | Phase 1, Phase 2 early selector, Phase 8 plan | Provider selector early increment; complete UI planned |
| §15 | Shared streaming event protocol | Phase 1 and Phase 7 plans | Text/run events implemented; tool events planned |
| §16 | Workspace and package layout | Phase 1–7 file structures | Incremental; future packages are specified by plans |
| §17 | Timeouts, cancellation, provider/MCP/tool failures | Phase 9 plan | Planned |
| §18 | Structured redacted logging | Phase 9 plan | Planned |
| §19 | Tool registration and safety policy | Phase 5, Phase 7, Phase 9 plans | Planned |
| §20 | Unit tests and mocked external services | All phase plans, especially Phase 9 | Partial; current implemented phases have tests |
| §21 | SOLID, inversion, strict typing, YAGNI | root/component `AGENTS.md` | Active project rules |
| §22 | Explicitly deferred non-MVP features | `PROMT.md` §22 | Active product boundary |
| §23 | Full MVP acceptance criteria | Roadmap plus Phases 5–9 | Not yet complete |
| §24 | Ordered Phase 1–9 delivery | `docs/superpowers/ROADMAP.md` | Documented; only Phase 2 is marked DONE |
| §25 | Coding-agent workflow and verification | root `AGENTS.md` | Active project rules |

## Interpretation rules

- “Implemented” means code and verification evidence exist; a plan alone is
  never implementation evidence.
- “Planned” means the phase has an actionable plan but must not be silently
  implemented as part of another phase.
- A requirement intentionally narrowed by product decision is recorded in the
  relevant plan and this matrix; Anthropic is the current example.
- Update this matrix when a phase status changes, not when a plan is merely
  drafted.
