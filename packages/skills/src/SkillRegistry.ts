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
