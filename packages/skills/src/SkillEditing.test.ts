import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SkillRegistry } from "./SkillRegistry.js";

describe("skill editing", () => {
  it("edits, disables and removes a skill without losing disabled metadata on scan", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agenter-edit-skill-"));
    try {
      const registry = new SkillRegistry(dir);
      registry.add({ id: "research", name: "Research", description: "Look up", instructions: "Old" });
      registry.update({ id: "research", name: "Research", description: "New", instructions: "Changed", enabled: false });
      registry.scan();
      expect(registry.get("research")).toMatchObject({ instructions: "Changed", enabled: false });
      expect(registry.getContent("research")).toBeUndefined();
      expect(() => registry.update({ id: "../escape", name: "N", description: "D", instructions: "I" })).toThrow();
      registry.remove("research");
      registry.scan(); expect(registry.list()).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
