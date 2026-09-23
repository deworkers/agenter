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
