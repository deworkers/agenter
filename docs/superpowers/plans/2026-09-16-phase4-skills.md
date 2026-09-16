# Phase 4: Skill Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a filesystem-backed `SkillRegistry` that scans `skills/*/SKILL.md`, exposes cheap metadata (id/name/description) for every skill via a new `GET /api/skills` endpoint, and — when a caller manually names a `skillId` on `POST /messages` — loads that one skill's full markdown body on demand and injects it into the LLM context as an additional system message, while also marking it as the active skill for Phase 3's `ProviderRouter`.

**Architecture:** This plan assumes Phase 2 (`ProviderRegistry`, multi-provider config, `AgentRuntime(registry, storage, systemPrompt?)`) and Phase 3 (`ProviderRouter`, `TaskType`, `RoutingContext`, `AgentRuntime(registry, storage, router, systemPrompt?)` with `runTurn(chatId, userMessage, options?: RunTurnOptions)`) have already shipped exactly as their plans (`docs/superpowers/plans/2026-09-16-phase2-provider-registry.md`, `docs/superpowers/plans/2026-09-16-phase3-provider-router.md`) left them — if either hasn't shipped yet, complete it first; this plan only adds new capability on top of `RunTurnOptions`/`RoutingContext`, it does not re-litigate their signatures. `SkillRegistry` (new, in a new package `packages/skills`) is a self-contained filesystem component: it scans a `skills/` directory, splits each `SKILL.md`'s YAML frontmatter from its markdown body with a small hand-rolled parser, keeps only the frontmatter (id/name/description) in memory, and re-reads a skill's body from disk on demand via `getContent(id)` — never eagerly loading every skill's body. `packages/agent-core` gains no dependency on `SkillRegistry` at all: `ContextBuilder.buildContext` grows one new optional field, `activeSkillContent?: string` (a plain string, appended as an extra system-role message), and `AgentRuntime`'s existing `RunTurnOptions` (Phase 3) grows a matching `activeSkillContent?: string` field that `runTurn` forwards straight into `buildContext`. `apps/api` is the composition root that ties skills to routing: `ChatService.sendMessage` gains an optional `skillId` on its options; when present, it resolves the skill's full body via the injected `SkillRegistry`, passes it as `activeSkillContent`, and also sets `routingContext.activeSkill = skillId` — populating the exact seam Phase 3's plan called out ("Phase 4 adds a real `activeSkill` value at the call site in `apps/api`"), so a request with `skillId` and `mode: "auto"` routes to the `"coding"` task type through the unchanged `ProviderRouter`. Skill selection stays manual in this phase (the caller sends `skillId` explicitly, mirroring how `providerId` is manually picked) — `SkillRegistry.list()`'s cheap metadata is the seam a later automatic-selection feature would consult, without changing `SkillRegistry`'s public shape.

**Tech Stack:** Same as Phase 1/2/3 (Node.js with `node:sqlite`, TypeScript strict, Express, Vitest, npm workspaces). One new exact-pinned dependency reused from `apps/api`: `yaml@2.9.1`, now also added to the new `packages/skills`.

**Spec:** `PROMT.md` §3 (`SkillRegistry` listed as a core backend component, between `ContextBuilder` and `ToolRegistry` in the request flow), §7 (Skills — filesystem layout, frontmatter format, the five `SkillRegistry` responsibilities, lazy-loading requirement, manual selection for "the first stage", architecture must allow automatic selection later), §13 (`GET /api/skills` endpoint), §16 (`packages/skills/` and top-level `skills/code-review`, `skills/research` in the preferred project structure). The auto-routing integration point comes from Phase 3's plan (`RoutingContext.activeSkill`, populated here for the first time).

## Global Constraints

- Node.js >=24.0.0, using built-in `node:sqlite` — unchanged from Phase 1/2/3.
- TypeScript strict mode (`tsconfig.base.json`, includes `noUncheckedIndexedAccess: true`) — every new/modified package extends it unchanged.
- New dependency (`yaml@2.9.1` in `packages/skills`) pinned to the exact version already used elsewhere in the repo, installed via `npm install yaml@2.9.1 --workspace=@agenter/skills --save-exact`.
- `AgentRuntime` and all of `packages/agent-core` stay filesystem-agnostic — they know only the plain string `activeSkillContent`, never a `SkillRegistry`, a directory path, or a `SKILL.md` format (PROMT.md §7: skill file I/O lives outside `agent-core`, same split established for `ProviderRegistry`/`providerFactory.ts` in Phase 2).
- "Не добавлять содержимое всех SKILL.md в каждый prompt" (do not inject every `SKILL.md`'s content into every prompt) — `SkillRegistry.list()` returns only id/name/description; `getContent(id)` loads one skill's full body only when a request actually names that `skillId`.
- Vitest for all tests, mirroring each package's existing `test` script (`vitest run`).
- Every package's `tsconfig.json` extends `tsconfig.base.json` and every `package.json` follows the existing shape (`private: true`, `type: module`, `main`/`types` → `./src/index.ts`, `typecheck`/`test` scripts).
- No `AnthropicProvider`, no frontend changes (`apps/web` is Phase 8 — no skill selector UI yet), no automatic/LLM-based skill selection (PROMT.md §7 explicitly defers this; only the seam for it is built).

## Decisions worth flagging

- **`SkillRegistry` lives in a new `packages/skills`, and `packages/agent-core` gets no `SkillRegistry`-related type at all** — not even an interface. PROMT.md §3 lists `SkillRegistry` as a core component alongside `AgentRuntime`/`ContextBuilder`, which could suggest putting it (or an interface for it) in `agent-core`, mirroring the `ChatStorage`/`SqliteChatStorage` split. But unlike storage, nothing in `agent-core` ever needs to call a `SkillRegistry` method — `ContextBuilder` and `AgentRuntime` only need one already-resolved string (`activeSkillContent`). Resolving *which* skill and loading its body is entirely `apps/api`'s job (the same place that already resolves `providerId`/`routingContext` before calling `runTurn`), so introducing a type in `agent-core` that nothing there consumes would be speculative plumbing. `packages/skills` is a leaf package with zero dependency on `agent-core`.
- **Frontmatter parsing is a hand-rolled line-based splitter plus the `yaml` package for the frontmatter block only**, not a new `gray-matter` dependency. The format PROMT.md §7 specifies is deliberately simple (two string fields, `name`/`description`, between two `---` lines) and `yaml` is already a pinned dependency elsewhere in this monorepo (`apps/api`, for `providers.yaml`/`routing.yaml`) — reusing it avoids adding a second frontmatter library for a two-field format.
- **`getContent(id)` re-reads the skill's `SKILL.md` from disk on every call; `scan()` never retains a skill's body in memory**, only its parsed metadata. This is the literal reading of PROMT.md §7's "загружать полное содержимое skill только когда оно необходимо" (load the full content only when needed) — the in-memory registry stays cheap regardless of how large any one skill's body grows, and skill files are small enough that repeated reads cost nothing measurable.
- **`SkillRegistry.list()` sorts by id before returning**, since `node:fs`'s `readdirSync` order is not guaranteed to be stable or alphabetical across platforms. This keeps `GET /api/skills`'s response order deterministic without adding any behavior beyond what "list available skills" requires.
- **A missing `skills/` directory is treated as zero skills, not a startup crash.** `scan()` checks the directory exists before reading it. This keeps `apps/api` bootable before Task 5 creates any example skill files, and keeps a fresh clone usable without a required `mkdir skills` step.
- **Manual selection only, via a `skillId` string on `POST /messages`** — PROMT.md §7 explicitly permits this for "the first stage" ("На первом этапе допустим ручной выбор skill пользователем") and defers automatic selection to later. Nothing here blocks that later step: `GET /api/skills` already exposes the cheap metadata (`id`/`name`/`description`) an automatic-selection feature (rule-based or LLM-based) would consult, and `ChatService.sendMessage` is the single call site that would swap "read `skillId` from the request body" for "compute `skillId` from metadata + message content" without touching `SkillRegistry`, `ContextBuilder`, or `AgentRuntime`.
- **An unknown `skillId` throws inside `ChatService.sendMessage`'s generator body, before `AgentRuntime.runTurn` (and therefore before `storage.addMessage`) is ever called.** `routes/messages.ts`'s existing `try`/`catch` around its `for await` loop (unchanged since Phase 1) already converts any thrown error from `sendMessage` into a `run.error` SSE event — no new error-handling code is needed there. The user's triggering message is *not* persisted in this case, unlike an unknown `providerId` (Phase 2/3), which persists the user message before `AgentRuntime` reports `run.error` — the skill lookup fails one step earlier, before any storage write happens.
- **`ChatService.sendMessage`'s no-options forwarding shape changes from passing `undefined` through to passing a (possibly empty) options object**, because Task 4 needs to destructure `skillId` out of `options` before forwarding the rest to `runTurn`. `AgentRuntime.runTurn` already defaults its `options` parameter to `{}` internally (Phase 3), so `{}` and `undefined` are behaviorally identical at the call site — only the `ChatService.test.ts` assertion for the no-options case changes (`toHaveBeenCalledWith("c1", "hello", {})` instead of `..., undefined)`), not runtime behavior.
- **`GET /api/skills` responds `{ skills: [...] }`, not a bare array** — consistent with Phase 2's change to `GET /api/providers` (`{ providers: [...], defaultProviderId }`), and leaves room for a future top-level field (e.g. a default/active skill) without a breaking response-shape change.
- **`SkillRegistry.scan()` runs once at process bootstrap.** A skill added to disk after the process starts won't appear until restart. PROMT.md §7 has no file-watching requirement, and every other piece of filesystem-backed config in this repo (`providers.yaml`, `routing.yaml`) is likewise loaded once at startup — this matches that existing pattern rather than introducing a new one.

---

## File Structure

```text
agenter/
├── skills/                                   NEW — example skill content, scanned by SkillRegistry
│   ├── code-review/
│   │   └── SKILL.md                          NEW
│   └── research/
│       └── SKILL.md                          NEW
│
├── packages/
│   ├── skills/                               NEW — @agenter/skills
│   │   ├── package.json                      NEW
│   │   ├── tsconfig.json                     NEW
│   │   └── src/
│   │       ├── types.ts                       NEW — SkillMetadata
│   │       ├── parseSkillFile.ts               NEW — frontmatter/body splitter
│   │       ├── parseSkillFile.test.ts          NEW
│   │       ├── SkillRegistry.ts                NEW — scan(), list(), getContent(id)
│   │       ├── SkillRegistry.test.ts           NEW
│   │       └── index.ts                        NEW — barrel export
│   │
│   └── agent-core/
│       └── src/
│           ├── ContextBuilder.ts               MODIFIED — buildContext accepts activeSkillContent?
│           ├── ContextBuilder.test.ts          MODIFIED
│           ├── AgentRuntime.ts                 MODIFIED — RunTurnOptions gains activeSkillContent?
│           └── AgentRuntime.test.ts            MODIFIED
│
└── apps/
    └── api/
        ├── package.json                        MODIFIED — add @agenter/skills dependency
        └── src/
            ├── routes/skills.ts                 NEW — GET /api/skills
            ├── services/ChatService.ts          MODIFIED — sendMessage resolves skillId via SkillRegistry
            ├── services/ChatService.test.ts     MODIFIED
            ├── routes/messages.ts               MODIFIED — reads skillId from body
            └── index.ts                         MODIFIED — constructs/scans SkillRegistry, mounts route, wires into ChatService
```

---

## Task 1: packages/skills — SkillMetadata, frontmatter parser, SkillRegistry

**Files:**
- Create: `packages/skills/package.json`
- Create: `packages/skills/tsconfig.json`
- Create: `packages/skills/src/types.ts`
- Create: `packages/skills/src/parseSkillFile.ts`
- Test: `packages/skills/src/parseSkillFile.test.ts`
- Create: `packages/skills/src/SkillRegistry.ts`
- Test: `packages/skills/src/SkillRegistry.test.ts`
- Create: `packages/skills/src/index.ts`

**Interfaces:**
- Consumes: `yaml`'s `parse` function (new dependency, pinned `2.9.1`, same version already used in `apps/api`).
- Produces: `interface SkillMetadata { id: string; name: string; description: string }`; `function parseSkillFile(raw: string): { name: string; description: string; body: string }`; `class SkillRegistry` with constructor `(skillsDir: string)`, methods `scan(): void`, `list(): SkillMetadata[]`, `getContent(id: string): string | undefined`. Task 3 (`apps/api` bootstrap) constructs `new SkillRegistry(skillsDirPath)` and calls `.scan()` once at startup; Task 3's route and Task 4's `ChatService` consume `.list()`/`.getContent()`.

- [ ] **Step 1: Create the package skeleton**

```json
// packages/skills/package.json
{
  "name": "@agenter/skills",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "yaml": "2.9.1"
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "vitest": "5.0.0",
    "@types/node": "26.5.1"
  }
}
```

```json
// packages/skills/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

```ts
// packages/skills/src/types.ts
export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
}
```

Run `npm install` from the repo root afterward so the new workspace package gets linked and `yaml`'s lockfile entry is added:

```bash
npm install
```

- [ ] **Step 2: Write the failing test for the frontmatter parser**

```ts
// packages/skills/src/parseSkillFile.test.ts
import { describe, expect, it } from "vitest";
import { parseSkillFile } from "./parseSkillFile.js";

describe("parseSkillFile", () => {
  it("splits frontmatter metadata from the markdown body", () => {
    const raw = [
      "---",
      "name: code-review",
      "description: Review source code for bugs and maintainability",
      "---",
      "",
      "# Code Review",
      "",
      "When reviewing code:",
      "",
      "1. Inspect correctness.",
      "",
    ].join("\n");

    const result = parseSkillFile(raw);

    expect(result.name).toBe("code-review");
    expect(result.description).toBe("Review source code for bugs and maintainability");
    expect(result.body).toBe(
      ["# Code Review", "", "When reviewing code:", "", "1. Inspect correctness.", ""].join("\n")
    );
  });

  it("throws when the file does not start with a frontmatter delimiter", () => {
    expect(() => parseSkillFile("# No frontmatter here\n")).toThrow(
      "SKILL.md must start with a '---' frontmatter delimiter"
    );
  });

  it("throws when the frontmatter has no closing delimiter", () => {
    expect(() => parseSkillFile(["---", "name: x", "description: y"].join("\n"))).toThrow(
      "SKILL.md frontmatter is missing its closing '---' delimiter"
    );
  });

  it("throws when name is missing from frontmatter", () => {
    const raw = ["---", "description: missing name", "---", "body"].join("\n");
    expect(() => parseSkillFile(raw)).toThrow("SKILL.md frontmatter is missing a 'name' field");
  });

  it("throws when description is missing from frontmatter", () => {
    const raw = ["---", "name: missing-description", "---", "body"].join("\n");
    expect(() => parseSkillFile(raw)).toThrow("SKILL.md frontmatter is missing a 'description' field");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/skills
npx vitest run src/parseSkillFile.test.ts
```

Expected: FAIL — `Cannot find module './parseSkillFile.js'`.

- [ ] **Step 4: Implement `parseSkillFile.ts`**

```ts
// packages/skills/src/parseSkillFile.ts
import { parse as parseYaml } from "yaml";

export interface ParsedSkillFile {
  name: string;
  description: string;
  body: string;
}

const FRONTMATTER_DELIMITER = "---";

export function parseSkillFile(raw: string): ParsedSkillFile {
  const lines = raw.split("\n");

  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error("SKILL.md must start with a '---' frontmatter delimiter");
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER);
  if (closingIndex === -1) {
    throw new Error("SKILL.md frontmatter is missing its closing '---' delimiter");
  }

  const frontmatterYaml = lines.slice(1, closingIndex).join("\n");
  const frontmatter = parseYaml(frontmatterYaml) as { name?: unknown; description?: unknown } | null;

  const name = frontmatter?.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("SKILL.md frontmatter is missing a 'name' field");
  }

  const description = frontmatter?.description;
  if (typeof description !== "string" || description.length === 0) {
    throw new Error("SKILL.md frontmatter is missing a 'description' field");
  }

  const body = lines
    .slice(closingIndex + 1)
    .join("\n")
    .replace(/^\n+/, "");

  return { name, description, body };
}
```

`ParsedSkillFile` is intentionally not `SkillMetadata` — it carries `body` too, which `SkillMetadata` (Step 1) never does. `SkillRegistry` (Step 6) narrows the two apart: `scan()` keeps only `{ id, name, description }` per skill, `getContent()` re-parses to get `body` alone.

- [ ] **Step 5: Run test again, confirm it passes**

```bash
npx vitest run src/parseSkillFile.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Write the failing test for SkillRegistry**

```ts
// packages/skills/src/SkillRegistry.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillRegistry } from "./SkillRegistry.js";

function writeSkill(skillsDir: string, id: string, name: string, description: string, body: string): void {
  const dir = path.join(skillsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), ["---", `name: ${name}`, `description: ${description}`, "---", "", body, ""].join("\n"));
}

describe("SkillRegistry", () => {
  let skillsDir: string;

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  it("scans a skills directory and lists metadata sorted by id", () => {
    skillsDir = mkdtempSync(path.join(tmpdir(), "agenter-skills-"));
    writeSkill(skillsDir, "research", "research", "Investigate a topic thoroughly", "# Research");
    writeSkill(
      skillsDir,
      "code-review",
      "code-review",
      "Review source code for bugs and maintainability",
      "# Code Review"
    );

    const registry = new SkillRegistry(skillsDir);
    registry.scan();

    expect(registry.list()).toEqual([
      { id: "code-review", name: "code-review", description: "Review source code for bugs and maintainability" },
      { id: "research", name: "research", description: "Investigate a topic thoroughly" },
    ]);
  });

  it("loads a skill's full body content only when getContent is called", () => {
    skillsDir = mkdtempSync(path.join(tmpdir(), "agenter-skills-"));
    writeSkill(skillsDir, "code-review", "code-review", "Review source code", "# Code Review\n\nInspect correctness.");

    const registry = new SkillRegistry(skillsDir);
    registry.scan();

    expect(registry.getContent("code-review")).toBe("# Code Review\n\nInspect correctness.\n");
  });

  it("returns undefined from getContent for an unregistered skill id", () => {
    skillsDir = mkdtempSync(path.join(tmpdir(), "agenter-skills-"));

    const registry = new SkillRegistry(skillsDir);
    registry.scan();

    expect(registry.getContent("missing")).toBeUndefined();
  });

  it("treats a missing skills directory as zero skills instead of throwing", () => {
    skillsDir = path.join(tmpdir(), "agenter-skills-does-not-exist");

    const registry = new SkillRegistry(skillsDir);

    expect(() => registry.scan()).not.toThrow();
    expect(registry.list()).toEqual([]);
  });

  it("skips a subdirectory that has no SKILL.md file", () => {
    skillsDir = mkdtempSync(path.join(tmpdir(), "agenter-skills-"));
    mkdirSync(path.join(skillsDir, "empty-dir"), { recursive: true });
    writeSkill(skillsDir, "code-review", "code-review", "Review source code", "# Code Review");

    const registry = new SkillRegistry(skillsDir);
    registry.scan();

    expect(registry.list().map((s) => s.id)).toEqual(["code-review"]);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

```bash
npx vitest run src/SkillRegistry.test.ts
```

Expected: FAIL — `Cannot find module './SkillRegistry.js'`.

- [ ] **Step 8: Implement `SkillRegistry.ts`**

```ts
// packages/skills/src/SkillRegistry.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSkillFile } from "./parseSkillFile.js";
import type { SkillMetadata } from "./types.js";

export class SkillRegistry {
  private readonly metadata = new Map<string, SkillMetadata>();

  constructor(private readonly skillsDir: string) {}

  scan(): void {
    this.metadata.clear();
    if (!existsSync(this.skillsDir)) return;

    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFilePath = path.join(this.skillsDir, entry.name, "SKILL.md");
      if (!existsSync(skillFilePath)) continue;

      const { name, description } = parseSkillFile(readFileSync(skillFilePath, "utf-8"));
      this.metadata.set(entry.name, { id: entry.name, name, description });
    }
  }

  list(): SkillMetadata[] {
    return [...this.metadata.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getContent(id: string): string | undefined {
    if (!this.metadata.has(id)) return undefined;

    const skillFilePath = path.join(this.skillsDir, id, "SKILL.md");
    const { body } = parseSkillFile(readFileSync(skillFilePath, "utf-8"));
    return body;
  }
}
```

`getContent` re-reads and re-parses the file on every call rather than caching `body` on `scan()` — this is the literal "load full content only when needed" requirement from PROMT.md §7: the in-memory `metadata` map only ever holds `{ id, name, description }`, never a skill's body.

- [ ] **Step 9: Run test again, confirm it passes**

```bash
npx vitest run src/SkillRegistry.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 10: Add the barrel export**

```ts
// packages/skills/src/index.ts
export * from "./types.js";
export * from "./parseSkillFile.js";
export * from "./SkillRegistry.js";
```

- [ ] **Step 11: Typecheck, lint, test the whole package**

```bash
cd ../..
npm run typecheck --workspace=@agenter/skills
npm run test --workspace=@agenter/skills
npm run lint
```

Expected: no errors, all tests pass.

- [ ] **Step 12: Commit**

```bash
git add packages/skills package.json package-lock.json
git commit -m "feat(skills): add SkillRegistry with lazy content loading"
```

---

## Task 2: agent-core — ContextBuilder and RunTurnOptions accept skill content

**Files:**
- Modify: `packages/agent-core/src/ContextBuilder.ts`
- Modify: `packages/agent-core/src/ContextBuilder.test.ts`
- Modify: `packages/agent-core/src/AgentRuntime.ts`
- Modify: `packages/agent-core/src/AgentRuntime.test.ts`

**Interfaces:**
- Consumes: nothing new — `ContextBuilder` and `AgentRuntime` still take only plain strings, never `SkillRegistry` (Task 1) or a filesystem path.
- Produces: `buildContext` accepts an additional optional `activeSkillContent?: string` field on its input, appended as an extra `system`-role message right before the current user message; `RunTurnOptions` (Phase 3) grows a matching `activeSkillContent?: string` field, which `runTurn` forwards into `buildContext`. Task 4 (`apps/api`'s `ChatService`) is the only place that ever populates `activeSkillContent` with a real value (the resolved skill body).

- [ ] **Step 1: Write the failing test for `buildContext`**

Add this `describe` block to the existing `packages/agent-core/src/ContextBuilder.test.ts` (its current two tests, for system-prompt-first ordering and an empty system prompt, are unaffected and stay as-is):

```ts
// packages/agent-core/src/ContextBuilder.test.ts — add alongside the existing describe block
describe("buildContext with an active skill", () => {
  it("appends the skill's content as an extra system message before the current message", () => {
    const result = buildContext({
      systemPrompt: "You are a helpful assistant.",
      activeSkillContent: "# Code Review\n\nInspect correctness.",
      history: [],
      currentMessage: "review this diff",
    });

    expect(result).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "system", content: "# Code Review\n\nInspect correctness." },
      { role: "user", content: "review this diff" },
    ]);
  });

  it("omits the extra system message when activeSkillContent is not given", () => {
    const result = buildContext({
      systemPrompt: "You are a helpful assistant.",
      history: [],
      currentMessage: "hi",
    });

    expect(result).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "hi" },
    ]);
  });

  it("still appends the skill message when systemPrompt is empty", () => {
    const result = buildContext({
      systemPrompt: "",
      activeSkillContent: "# Research\n\nGather sources.",
      history: [],
      currentMessage: "look into this",
    });

    expect(result).toEqual([
      { role: "system", content: "# Research\n\nGather sources." },
      { role: "user", content: "look into this" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agent-core
npx vitest run src/ContextBuilder.test.ts
```

Expected: FAIL — `buildContext`'s input type doesn't have `activeSkillContent` yet (TypeScript error) and the extra system message is never appended.

- [ ] **Step 3: Update `ContextBuilder.ts`**

```ts
// packages/agent-core/src/ContextBuilder.ts
import type { ChatMessage, StoredMessage } from "./types.js";

export interface BuildContextInput {
  systemPrompt: string;
  activeSkillContent?: string;
  history: StoredMessage[];
  currentMessage: string;
}

export function buildContext(input: BuildContextInput): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (input.systemPrompt.length > 0) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  if (input.activeSkillContent) {
    messages.push({ role: "system", content: input.activeSkillContent });
  }

  for (const stored of input.history) {
    messages.push({ role: stored.role, content: stored.content });
  }

  messages.push({ role: "user", content: input.currentMessage });

  return messages;
}
```

The skill's body is appended as its own `system`-role message rather than concatenated into `systemPrompt`'s string — this keeps the base system prompt and the skill instructions visibly separate in the message list (useful for debugging/inspection) without changing how any provider consumes `ChatMessage[]`.

- [ ] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/ContextBuilder.test.ts
```

Expected: all 5 tests PASS (2 pre-existing plus 3 new).

- [ ] **Step 5: Write the failing test for `RunTurnOptions.activeSkillContent`**

Add this test to the existing `packages/agent-core/src/AgentRuntime.test.ts` (its `fakeStorage`/`fakeProvider`/`registryWith`/`routingConfig` helpers from Phase 3 are reused unchanged):

```ts
// packages/agent-core/src/AgentRuntime.test.ts — add inside the existing describe("AgentRuntime.runTurn", ...) block
it("forwards activeSkillContent into the built context as an extra system message", async () => {
  const storage = fakeStorage();
  let capturedMessages: unknown;
  const provider: LlmProvider = {
    id: "fake",
    model: "fake-model",
    supportsTools: () => false,
    supportsVision: () => false,
    getContextWindow: () => 8192,
    async *chat(request) {
      capturedMessages = request.messages;
      yield { type: "done" };
    },
  };
  const registry = registryWith([provider], "fake");
  const router = new ProviderRouter(routingConfig);
  const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

  const events = [];
  for await (const event of runtime.runTurn("chat-1", "review this", {
    activeSkillContent: "# Code Review\n\nInspect correctness.",
  })) {
    events.push(event);
  }

  expect(capturedMessages).toEqual([
    { role: "system", content: "You are helpful." },
    { role: "system", content: "# Code Review\n\nInspect correctness." },
    { role: "user", content: "review this" },
  ]);
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
npx vitest run src/AgentRuntime.test.ts
```

Expected: FAIL — `RunTurnOptions` has no `activeSkillContent` field yet (TypeScript error), and `runTurn` never passes it to `buildContext`.

- [ ] **Step 7: Update `AgentRuntime.ts`**

```ts
// packages/agent-core/src/AgentRuntime.ts
import { buildContext } from "./ContextBuilder.js";
import type { ProviderRegistry } from "./ProviderRegistry.js";
import type { ProviderRouter, RoutingContext } from "./ProviderRouter.js";
import type { AgentEvent, ChatStorage } from "./types.js";

export interface RunTurnOptions {
  providerId?: string;
  mode?: "manual" | "auto";
  routingContext?: RoutingContext;
  activeSkillContent?: string;
}

export class AgentRuntime {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly storage: ChatStorage,
    private readonly router: ProviderRouter,
    private readonly systemPrompt: string = "You are a helpful assistant."
  ) {}

  async *runTurn(chatId: string, userMessage: string, options: RunTurnOptions = {}): AsyncGenerator<AgentEvent> {
    const history = this.storage.listMessages(chatId);
    const storedUserMessage = this.storage.addMessage({ chatId, role: "user", content: userMessage });

    const providerId = this.resolveProviderId(options);
    const provider = providerId ? this.registry.get(providerId) : this.registry.getDefault();
    if (!provider) {
      yield { type: "run.error", message: `Unknown provider "${providerId}"` };
      return;
    }

    const context = buildContext({
      systemPrompt: this.systemPrompt,
      activeSkillContent: options.activeSkillContent,
      history,
      currentMessage: userMessage,
    });

    yield { type: "run.started", provider: provider.id, model: provider.model };

    const startedAt = Date.now();
    let assistantText = "";

    for await (const event of provider.chat({ messages: context })) {
      if (event.type === "text.delta") {
        assistantText += event.text;
        yield { type: "text.delta", text: event.text };
        continue;
      }

      if (event.type === "error") {
        this.storage.addRun({
          chatId,
          messageId: storedUserMessage.id,
          provider: provider.id,
          model: provider.model,
          status: "error",
          durationMs: Date.now() - startedAt,
        });
        yield { type: "run.error", message: event.message };
        return;
      }

      this.storage.addMessage({
        chatId,
        role: "assistant",
        content: assistantText,
        provider: provider.id,
        model: provider.model,
      });

      this.storage.addRun({
        chatId,
        messageId: storedUserMessage.id,
        provider: provider.id,
        model: provider.model,
        status: "success",
        tokensIn: event.usage?.promptTokens,
        tokensOut: event.usage?.completionTokens,
        durationMs: Date.now() - startedAt,
      });

      this.storage.touchChat(chatId);

      yield { type: "run.completed", usage: event.usage };
    }
  }

  private resolveProviderId(options: RunTurnOptions): string | undefined {
    if (options.providerId) return options.providerId;
    if (options.mode === "auto") return this.router.resolveProviderId(options.routingContext ?? {});
    return undefined;
  }
}
```

Only two lines changed from Phase 3's version: `RunTurnOptions` gains `activeSkillContent?: string`, and the `buildContext` call now passes it through. `resolveProviderId`'s logic (Phase 3) is untouched.

- [ ] **Step 8: Run test again, confirm it passes**

```bash
npx vitest run src/AgentRuntime.test.ts
```

Expected: all 8 tests PASS (the 7 from Phase 3 plus this one).

- [ ] **Step 9: Typecheck, lint, test the whole package**

```bash
cd ../..
npm run typecheck --workspace=@agenter/agent-core
npm run test --workspace=@agenter/agent-core
npm run lint
```

Expected: no errors, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/agent-core
git commit -m "feat(agent-core): ContextBuilder and RunTurnOptions accept activeSkillContent"
```

---

## Task 3: apps/api — wire SkillRegistry into bootstrap, add GET /api/skills

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/routes/skills.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `SkillRegistry` (Task 1).
- Produces: `createSkillsRouter(registry: SkillRegistry): Router` mounted at `GET /api/skills`, responding `{ skills: SkillMetadata[] }`. Task 4 (`ChatService`) consumes the same `SkillRegistry` instance constructed here (passed into `ChatService`'s constructor).

- [ ] **Step 1: Add the `@agenter/skills` dependency to `apps/api`**

```json
// apps/api/package.json — add to "dependencies"
"@agenter/skills": "0.1.0",
```

```bash
npm install
```

- [ ] **Step 2: Create `routes/skills.ts`**

```ts
// apps/api/src/routes/skills.ts
import { Router } from "express";
import type { SkillRegistry } from "@agenter/skills";

export function createSkillsRouter(registry: SkillRegistry): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ skills: registry.list() });
  });

  return router;
}
```

There is no dedicated test file for this route (it has no branching logic beyond what `SkillRegistry.list()` already tests in Task 1) — its behavior is exercised directly in Step 4's manual verification, matching how `routes/providers.ts` and `routes/chats.ts` (Phase 1/2) are also untested at the route layer, with their logic tested one level down.

- [ ] **Step 3: Wire `SkillRegistry` into `apps/api/src/index.ts` bootstrap**

```ts
// apps/api/src/index.ts
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRuntime, ProviderRouter } from "@agenter/agent-core";
import { SqliteChatStorage } from "@agenter/storage";
import { SkillRegistry } from "@agenter/skills";
import { loadConfig } from "./config.js";
import { buildProviderRegistry } from "./providerFactory.js";
import { ChatService } from "./services/ChatService.js";
import { createChatsRouter } from "./routes/chats.js";
import { createProvidersRouter } from "./routes/providers.js";
import { createSkillsRouter } from "./routes/skills.js";
import { createMessagesRouter } from "./routes/messages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = loadConfig();

const storage = new SqliteChatStorage(config.dbPath);
const registry = buildProviderRegistry(config);
const router = new ProviderRouter(config.routing);
const runtime = new AgentRuntime(registry, storage, router);

const skillsDir = path.resolve(__dirname, "../../../skills");
const skillRegistry = new SkillRegistry(skillsDir);
skillRegistry.scan();

const chatService = new ChatService(storage, runtime);

const app = express();
app.use(express.json());

app.use("/api/chats", createChatsRouter(chatService));
app.use("/api/chats", createMessagesRouter(chatService));
app.use("/api/providers", createProvidersRouter(registry));
app.use("/api/skills", createSkillsRouter(skillRegistry));

app.listen(config.port, () => {
  console.log(`agenter api listening on http://localhost:${config.port}`);
});
```

This assumes Phase 3's `index.ts` (constructing `registry`, `router`, `runtime` exactly this way) is already in place — if it isn't, complete Phase 2/3 first. This step only adds the `skillsDir`/`skillRegistry` construction and the new route mount; `chatService`'s construction is deliberately left as the existing two-argument `new ChatService(storage, runtime)` call for now — Task 4 changes `ChatService`'s constructor to require a `SkillRegistry` third argument and updates this exact call site in the same task, so the two never drift out of sync mid-task.

`skillsDir` resolves to the top-level `skills/` directory (`agenter/skills/`, sibling to `apps/` and `packages/`), the same three-levels-up pattern `config.ts` already uses to reach `agenter/config/providers.yaml` from `apps/api/src/config.ts`.

- [ ] **Step 4: Manual verification (skill listing only — full flow verified in Task 5)**

```bash
mkdir -p skills/code-review
cat > skills/code-review/SKILL.md <<'EOF'
---
name: code-review
description: Review source code for bugs and maintainability
---

# Code Review

When reviewing code:

1. Inspect correctness.
EOF

npm run dev --workspace=@agenter/api
```

In another terminal:

```bash
curl http://localhost:3000/api/skills
```

Expected: `{"skills":[{"id":"code-review","name":"code-review","description":"Review source code for bugs and maintainability"}]}`. Stop the dev server (`Ctrl+C`) once confirmed. Leave `skills/code-review/SKILL.md` in place — Task 5 recreates it as a permanent fixture with the exact same content.

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck --workspace=@agenter/api
npm run lint
```

Expected: no errors. `skillRegistry` is constructed and scanned, and `createSkillsRouter(skillRegistry)` is mounted, but nothing yet reads a skill's content into a request — `chatService` still takes only `(storage, runtime)`, unchanged from Phase 3. Task 4 is what makes `ChatService` actually depend on `skillRegistry`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/routes/skills.ts apps/api/src/index.ts package-lock.json
git commit -m "feat(api): add SkillRegistry bootstrap and GET /api/skills"
```

---

## Task 4: apps/api — ChatService resolves skillId into activeSkillContent and routingContext.activeSkill

**Files:**
- Modify: `apps/api/src/services/ChatService.ts`
- Modify: `apps/api/src/services/ChatService.test.ts`
- Modify: `apps/api/src/routes/messages.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `SkillRegistry` (Task 1), `AgentRuntime` with `runTurn(chatId, userMessage, options?: RunTurnOptions)` where `RunTurnOptions` now includes `activeSkillContent?: string` (Task 2), the `skillRegistry` instance already constructed and scanned in `apps/api/src/index.ts` by Task 3.
- Produces: `class ChatService` with constructor `(storage: ChatStorage, runtime: AgentRuntime, skills: SkillRegistry)` and `sendMessage(chatId: string, content: string, options?: SendMessageOptions): AsyncGenerator<AgentEvent>` where `interface SendMessageOptions { providerId?: string; mode?: "manual" | "auto"; routingContext?: RoutingContext; skillId?: string }`. Consumed by `routes/messages.ts`.

- [ ] **Step 1: Update `ChatService.test.ts`**

Replace the file's fixtures and the two `sendMessage`-related tests at the bottom (the four chat-management tests above them — create/list/get/delete — are unaffected except for `fakeRuntime`'s call sites gaining the new third constructor argument):

```ts
// apps/api/src/services/ChatService.test.ts
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, Chat, ChatStorage, StoredMessage } from "@agenter/agent-core";
import type { SkillRegistry } from "@agenter/skills";
import { ChatService } from "./ChatService.js";

function fakeStorage(chats: Chat[] = [], messagesByChat: Record<string, StoredMessage[]> = {}): ChatStorage {
  return {
    createChat: vi.fn((title: string) => {
      const chat: Chat = { id: "new-id", title, createdAt: "t", updatedAt: "t" };
      chats.push(chat);
      return chat;
    }),
    listChats: vi.fn(() => chats),
    getChat: vi.fn((id: string) => chats.find((c) => c.id === id)),
    deleteChat: vi.fn((id: string) => {
      const idx = chats.findIndex((c) => c.id === id);
      if (idx >= 0) chats.splice(idx, 1);
    }),
    touchChat: vi.fn(),
    listMessages: vi.fn((chatId: string) => messagesByChat[chatId] ?? []),
    addMessage: vi.fn(),
    addRun: vi.fn(),
  };
}

function fakeRuntime(events: AgentEvent[]) {
  return {
    runTurn: vi.fn(async function* () {
      for (const event of events) yield event;
    }),
  };
}

function fakeSkillRegistry(content: Record<string, string> = {}): SkillRegistry {
  return {
    scan: vi.fn(),
    list: vi.fn(() => []),
    getContent: vi.fn((id: string) => content[id]),
  } as unknown as SkillRegistry;
}

describe("ChatService", () => {
  it("creates a chat with a default title when none is given", () => {
    const storage = fakeStorage();
    const service = new ChatService(storage, fakeRuntime([]) as never, fakeSkillRegistry());

    const chat = service.createChat();

    expect(storage.createChat).toHaveBeenCalledWith("New chat");
    expect(chat.id).toBe("new-id");
  });

  it("lists chats via storage", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const storage = fakeStorage([existing]);
    const service = new ChatService(storage, fakeRuntime([]) as never, fakeSkillRegistry());

    expect(service.listChats()).toEqual([existing]);
  });

  it("returns chat with messages, or undefined if the chat does not exist", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const message: StoredMessage = {
      id: "m1",
      chatId: "c1",
      role: "user",
      content: "hi",
      provider: null,
      model: null,
      createdAt: "t",
    };
    const storage = fakeStorage([existing], { c1: [message] });
    const service = new ChatService(storage, fakeRuntime([]) as never, fakeSkillRegistry());

    expect(service.getChatWithMessages("c1")).toEqual({ chat: existing, messages: [message] });
    expect(service.getChatWithMessages("missing")).toBeUndefined();
  });

  it("deletes a chat via storage", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const storage = fakeStorage([existing]);
    const service = new ChatService(storage, fakeRuntime([]) as never, fakeSkillRegistry());

    service.deleteChat("c1");

    expect(storage.deleteChat).toHaveBeenCalledWith("c1");
  });

  it("delegates sendMessage to AgentRuntime.runTurn and forwards its events", async () => {
    const events: AgentEvent[] = [
      { type: "run.started", provider: "p", model: "m" },
      { type: "text.delta", text: "hi" },
      { type: "run.completed" },
    ];
    const storage = fakeStorage();
    const runtime = fakeRuntime(events);
    const service = new ChatService(storage, runtime as never, fakeSkillRegistry());

    const received: AgentEvent[] = [];
    for await (const event of service.sendMessage("c1", "hello")) {
      received.push(event);
    }

    expect(received).toEqual(events);
    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "hello", {});
  });

  it("forwards providerId, mode, and routingContext options to AgentRuntime.runTurn when no skillId is given", async () => {
    const storage = fakeStorage();
    const runtime = fakeRuntime([]);
    const service = new ChatService(storage, runtime as never, fakeSkillRegistry());

    const options = { mode: "auto" as const, routingContext: { toolsRequired: true } };
    const received: AgentEvent[] = [];
    for await (const event of service.sendMessage("c1", "hello", options)) {
      received.push(event);
    }

    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "hello", options);
  });

  it("resolves skillId into activeSkillContent and sets routingContext.activeSkill", async () => {
    const storage = fakeStorage();
    const runtime = fakeRuntime([]);
    const skills = fakeSkillRegistry({ "code-review": "# Code Review\n\nInspect correctness." });
    const service = new ChatService(storage, runtime as never, skills);

    const received: AgentEvent[] = [];
    for await (const event of service.sendMessage("c1", "review this", {
      mode: "auto",
      skillId: "code-review",
    })) {
      received.push(event);
    }

    expect(skills.getContent).toHaveBeenCalledWith("code-review");
    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "review this", {
      mode: "auto",
      activeSkillContent: "# Code Review\n\nInspect correctness.",
      routingContext: { activeSkill: "code-review" },
    });
  });

  it("merges activeSkill into an existing routingContext without dropping other fields", async () => {
    const storage = fakeStorage();
    const runtime = fakeRuntime([]);
    const skills = fakeSkillRegistry({ "code-review": "# Code Review" });
    const service = new ChatService(storage, runtime as never, skills);

    const received: AgentEvent[] = [];
    for await (const event of service.sendMessage("c1", "review this", {
      mode: "auto",
      skillId: "code-review",
      routingContext: { toolsRequired: true },
    })) {
      received.push(event);
    }

    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "review this", {
      mode: "auto",
      activeSkillContent: "# Code Review",
      routingContext: { toolsRequired: true, activeSkill: "code-review" },
    });
  });

  it("throws when skillId does not match a registered skill, without calling runTurn", async () => {
    const storage = fakeStorage();
    const runtime = fakeRuntime([]);
    const service = new ChatService(storage, runtime as never, fakeSkillRegistry());

    const drain = async () => {
      for await (const _event of service.sendMessage("c1", "hi", { skillId: "missing" })) {
        // draining the generator to trigger the throw
      }
    };

    await expect(drain()).rejects.toThrow('Unknown skill "missing"');
    expect(runtime.runTurn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api
npx vitest run src/services/ChatService.test.ts
```

Expected: FAIL — `ChatService`'s constructor doesn't accept a third argument yet, `SendMessageOptions` has no `skillId` field, and `sendMessage` never resolves it.

- [ ] **Step 3: Update `ChatService.ts`**

```ts
// apps/api/src/services/ChatService.ts
import type { AgentEvent, AgentRuntime, Chat, ChatStorage, RoutingContext, StoredMessage } from "@agenter/agent-core";
import type { SkillRegistry } from "@agenter/skills";

export interface ChatWithMessages {
  chat: Chat;
  messages: StoredMessage[];
}

export interface SendMessageOptions {
  providerId?: string;
  mode?: "manual" | "auto";
  routingContext?: RoutingContext;
  skillId?: string;
}

export class ChatService {
  constructor(
    private readonly storage: ChatStorage,
    private readonly runtime: AgentRuntime,
    private readonly skills: SkillRegistry
  ) {}

  listChats(): Chat[] {
    return this.storage.listChats();
  }

  createChat(title = "New chat"): Chat {
    return this.storage.createChat(title);
  }

  getChatWithMessages(id: string): ChatWithMessages | undefined {
    const chat = this.storage.getChat(id);
    if (!chat) return undefined;

    return { chat, messages: this.storage.listMessages(id) };
  }

  deleteChat(id: string): void {
    this.storage.deleteChat(id);
  }

  async *sendMessage(chatId: string, content: string, options: SendMessageOptions = {}): AsyncGenerator<AgentEvent> {
    const { skillId, ...rest } = options;

    if (!skillId) {
      yield* this.runtime.runTurn(chatId, content, rest);
      return;
    }

    const activeSkillContent = this.skills.getContent(skillId);
    if (activeSkillContent === undefined) {
      throw new Error(`Unknown skill "${skillId}"`);
    }

    yield* this.runtime.runTurn(chatId, content, {
      ...rest,
      activeSkillContent,
      routingContext: { ...rest.routingContext, activeSkill: skillId },
    });
  }
}
```

An unknown `skillId` throws before `this.runtime.runTurn` is called at all, so no user message is persisted for that request — `routes/messages.ts`'s existing `try`/`catch` (Step 5) turns the thrown error into a `run.error` SSE event, same as any other error surfaced mid-request.

- [ ] **Step 4: Run test again, confirm it passes**

```bash
npx vitest run src/services/ChatService.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Update `routes/messages.ts` to read `skillId` from the request body**

```ts
// apps/api/src/routes/messages.ts
import { Router } from "express";
import type { ChatService } from "../services/ChatService.js";

export function createMessagesRouter(chatService: ChatService): Router {
  const router = Router();

  router.post("/:id/messages", async (req, res) => {
    const content = req.body?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content must be a non-empty string" });
      return;
    }

    const providerId = typeof req.body?.providerId === "string" ? req.body.providerId : undefined;
    const mode = req.body?.mode === "auto" ? "auto" : req.body?.mode === "manual" ? "manual" : undefined;
    const skillId = typeof req.body?.skillId === "string" ? req.body.skillId : undefined;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      for await (const event of chatService.sendMessage(req.params.id, content, { providerId, mode, skillId })) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.write(`data: ${JSON.stringify({ type: "run.error", message })}\n\n`);
    } finally {
      res.end();
    }
  });

  return router;
}
```

`skillId` is read the same defensive way `providerId`/`mode` already are (Phase 2/3) — an absent or non-string value becomes `undefined`, which `ChatService.sendMessage` treats as "no skill selected."

- [ ] **Step 6: Update `apps/api/src/index.ts`'s `ChatService` construction**

`ChatService` now requires a third constructor argument. Change the one call site (added in Task 3 Step 3 as a two-argument call):

```ts
// apps/api/src/index.ts — change this one line
const chatService = new ChatService(storage, runtime, skillRegistry);
```

Every other line in `index.ts` (the `skillsDir`/`skillRegistry` construction, the `createSkillsRouter` mount) was already added in Task 3 and stays as-is.

- [ ] **Step 7: Typecheck, lint, full workspace test**

```bash
cd ../..
npm run typecheck
npm run lint
npm test
```

Expected: no errors, all tests across the workspace PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/ChatService.ts apps/api/src/services/ChatService.test.ts apps/api/src/routes/messages.ts apps/api/src/index.ts
git commit -m "feat(api): resolve skillId into activeSkillContent and routingContext.activeSkill"
```

---

## Task 5: example skill fixtures and end-to-end manual verification

**Files:**
- Create: `skills/code-review/SKILL.md`
- Create: `skills/research/SKILL.md`

**Interfaces:**
- Consumes: nothing — these are data fixtures scanned by `SkillRegistry` (Task 1) at `apps/api` bootstrap (Task 3).
- Produces: two real, spec-verbatim example skills on disk, giving `GET /api/skills` non-empty output and giving the manual verification below something real to select via `skillId`.

- [ ] **Step 1: Create `skills/code-review/SKILL.md`**

```markdown
---
name: code-review
description: Review source code for bugs and maintainability
---

# Code Review

When reviewing code:

1. Inspect correctness.
2. Look for security problems.
3. Look for unnecessary complexity.
4. Suggest concrete fixes.
```

This is PROMT.md §7's own example, verbatim — already created as a throwaway fixture in Task 3 Step 4's manual verification; this step makes it a permanent, committed file with identical content (overwrite if Task 3's copy was deleted or differs).

- [ ] **Step 2: Create `skills/research/SKILL.md`**

```markdown
---
name: research
description: Investigate a topic thoroughly using available sources
---

# Research

When researching a topic:

1. Identify the specific question being asked.
2. Gather information from multiple independent sources.
3. Note any conflicting information and flag it explicitly.
4. Summarize findings with citations to where each claim came from.
```

`skills/debugging/SKILL.md` (also named in PROMT.md §7's filesystem example) is not created in this phase — the spec lists it only as a filesystem-layout illustration, and the Definition of Done for Phase 4 needs at least one skill to exercise manual selection end-to-end, not all three. Nothing in `SkillRegistry` hardcodes an expected skill count or set of ids, so adding a `debugging` skill later is just dropping a new directory under `skills/`.

- [ ] **Step 3: Typecheck, lint, full workspace test**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: no errors, all tests across the workspace PASS.

- [ ] **Step 4: Manual verification — full skill-aware flow**

Start the API (adjust `config/providers.yaml`/`config/routing.yaml` to whatever's actually running locally):

```bash
npm run dev --workspace=@agenter/api
```

In another terminal, confirm both example skills are listed:

```bash
curl http://localhost:3000/api/skills
```

Expected: `{"skills":[{"id":"code-review","name":"code-review","description":"Review source code for bugs and maintainability"},{"id":"research","name":"research","description":"Investigate a topic thoroughly using available sources"}]}` (sorted by id).

Create a chat and send one message with `skillId: "code-review"` and `mode: "auto"` (no `providerId`):

```bash
CHAT_ID=$(curl -s -X POST http://localhost:3000/api/chats -H 'Content-Type: application/json' -d '{"title":"test"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')

curl -N -X POST "http://localhost:3000/api/chats/$CHAT_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"review this function for bugs","mode":"auto","skillId":"code-review"}'
```

Expected: streams `run.started` with `provider: "local-code"` — `skillId: "code-review"` sets `routingContext.activeSkill`, which `ProviderRouter.classify` (Phase 3) routes to the `"coding"` task type, which `config/routing.yaml` maps to `local-code` — followed by `text.delta` events reflecting the model having seen the code-review skill's instructions, then `run.completed`.

Send a second request with an unknown `skillId` to confirm the error path:

```bash
curl -N -X POST "http://localhost:3000/api/chats/$CHAT_ID/messages" \
  -H 'Content-Type: application/json' \
  -d '{"content":"hi","skillId":"does-not-exist"}'
```

Expected: a single SSE event, `data: {"type":"run.error","message":"Unknown skill \"does-not-exist\""}`. Stop the dev server (`Ctrl+C`) once confirmed.

- [ ] **Step 5: Commit**

```bash
git add skills/code-review/SKILL.md skills/research/SKILL.md
git commit -m "feat(skills): add code-review and research example skills"
```

## Self-review

**Spec coverage:** PROMT.md §3 lists `SkillRegistry` as a core component in the request flow between `ContextBuilder` and `ToolRegistry` — its data (metadata via `list()`, content via `getContent()`) reaches `AgentRuntime`/`ContextBuilder` through `apps/api`'s `ChatService` (Task 4), exactly where `ProviderRegistry`/`ProviderRouter` resolution already happens (Phase 2/3), keeping `agent-core` itself free of any `SkillRegistry` dependency (Decisions bullet 1). §7's five `SkillRegistry` responsibilities are each covered: (1) "сканировать директорию skills" → `SkillRegistry.scan()` (Task 1 Step 8); (2) "читать metadata" → `parseSkillFile` extracts `name`/`description` from frontmatter (Task 1 Step 4); (3) "регистрировать доступные skills" → `scan()` populates the in-memory `metadata` map (Task 1 Step 8); (4) "предоставлять список skills AgentRuntime" → `list()`, consumed one layer up by `GET /api/skills` (Task 3) rather than by `AgentRuntime` directly, per the architecture decision that `agent-core` never imports `SkillRegistry` — the *data* reaches the runtime as `activeSkillContent`, satisfying the intent (skill information flows into the agent's context) without the literal class reference; (5) "загружать полное содержимое skill только когда оно необходимо" → `getContent(id)` re-reads and re-parses on demand, never cached from `scan()` (Task 1 Step 8, Decisions bullet 3). The exact `SKILL.md` format (frontmatter + markdown body) is implemented verbatim in `parseSkillFile` (Task 1 Step 4) and exercised with the spec's own `code-review` example in both Task 1's tests and Task 5's fixture. "Не добавлять содержимое всех SKILL.md в каждый prompt" is satisfied structurally: `ContextBuilder`/`AgentRuntime` only ever see one resolved `activeSkillContent` string per request (Task 2), never a list of all skills' bodies. "Metadata можно использовать для определения подходящего skill" and "Архитектура должна позволять позже добавить автоматический выбор skills" are addressed by keeping `SkillRegistry.list()` as the sole metadata surface a future auto-selector would consult, with `ChatService.sendMessage`'s `skillId`-resolution step being the single call site that would change (Decisions bullet 5) — no task in this plan implements automatic selection, matching "на первом этапе допустим ручной выбор" (manual selection is acceptable at this first stage). §13's `GET /api/skills` is implemented in Task 3, responding `{ skills: [...] }` (Decisions bullet 7, mirroring Phase 2's `{ providers: [...], defaultProviderId }` shape change). §16's `packages/skills/` and top-level `skills/code-review/`, `skills/research/` are created in Task 1 and Task 5 respectively. The Phase 3 integration point (`RoutingContext.activeSkill`, called out in that plan's Decisions bullet 1 as something "Phase 4 adds... at the call site in apps/api") is implemented in Task 4's `ChatService.sendMessage`, which merges `activeSkill: skillId` into any existing `routingContext` without dropping other fields (tested explicitly in Task 4 Step 1's "merges activeSkill into an existing routingContext" case) — a request with both `skillId` and `mode: "auto"` now reaches `ProviderRouter.classify`'s `"coding"` branch (Phase 3's `if (context.activeSkill) return "coding"`), verified end-to-end in Task 5 Step 4's manual verification.

**Placeholder scan:** searched for "TBD", "TODO", "for now", "handle appropriately", "similar to Task N", "add validation" — none present as unresolved placeholders. Every code step contains complete, runnable TypeScript/JSON/YAML/Markdown/bash, not descriptions of code. The one place that assumes prior-phase state without restating its full content (Task 3 Step 3's `index.ts`) states the exact assumed prior signatures inline (`buildProviderRegistry(config)`, `new ProviderRouter(config.routing)`, `new AgentRuntime(registry, storage, router)`) rather than deferring to "whatever Phase 2/3 did" — consistent with how the Phase 3 plan handled the same kind of cross-phase dependency.

**Type consistency:** `SkillMetadata { id, name, description }` (Task 1 Step 1) is used identically in `SkillRegistry.list()`'s return type, `SkillRegistry.test.ts`'s assertions, and `GET /api/skills`'s response shape (Task 3). `ParsedSkillFile { name, description, body }` (Task 1 Step 4) is consumed identically by `SkillRegistry.scan()` (destructures `name`/`description`) and `SkillRegistry.getContent()` (destructures `body`) in Task 1 Step 8. `RunTurnOptions` gains `activeSkillContent?: string` in Task 2 Step 7 without altering any of Phase 3's existing fields (`providerId?`, `mode?`, `routingContext?`) — confirmed by Task 2 Step 5's test asserting the full `capturedMessages` shape alongside the pre-existing Phase 3 `AgentRuntime.test.ts` cases, which are left untouched. `BuildContextInput` gains the matching `activeSkillContent?: string` in Task 2 Step 3, consumed by `AgentRuntime.runTurn`'s `buildContext` call in the same task — same field name, same optionality, no renaming across the two files. `ChatService`'s constructor changes from `(storage, runtime)` (Phase 1/2/3) to `(storage, runtime, skills: SkillRegistry)` in Task 4 Step 3, matching its only call site — updated in the same task, Task 4 Step 6's `new ChatService(storage, runtime, skillRegistry)` — and every test constructor call in Task 4 Step 1's rewritten `ChatService.test.ts`. `SendMessageOptions` (Task 4 Step 3: `{ providerId?, mode?, routingContext?, skillId? }`) is a strict superset of Phase 3's `SendMessageOptions` — no field renamed or removed — and `sendMessage`'s forwarding logic passes `RunTurnOptions`-shaped objects (`{ ...rest, activeSkillContent, routingContext: {...} }`) that satisfy `AgentRuntime.runTurn`'s `RunTurnOptions` type from Task 2, confirmed by Task 4 Step 1's exact `toHaveBeenCalledWith` assertions on `runtime.runTurn`. The no-options `sendMessage` call now forwards `{}` instead of `undefined` (Decisions bullet 6) — Task 4 Step 1's first `sendMessage` test asserts `toHaveBeenCalledWith("c1", "hello", {})`, matching `AgentRuntime.runTurn`'s own `options: RunTurnOptions = {}` default from Task 2, so both the old and new shape are valid arguments to the same signature. `routes/messages.ts`'s body-parsing additions (`skillId`, Task 4 Step 5) use the same defensive `typeof req.body?.x === "string" ? req.body.x : undefined` pattern already established for `providerId` in Phase 2 — no new parsing convention introduced.
