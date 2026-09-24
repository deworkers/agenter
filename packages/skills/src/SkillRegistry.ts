// packages/skills/src/SkillRegistry.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { parseSkillFile } from "./parseSkillFile.js";
import type { SkillMetadata } from "./types.js";

export interface NewSkillInput extends SkillMetadata {
  instructions: string;
}

export class SkillConflictError extends Error {}

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

  add(input: NewSkillInput): SkillMetadata {
    const { id, name, description, instructions } = input;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
      throw new RangeError("Skill id must use lowercase letters, digits and hyphens");
    }
    if (!name.trim() || !description.trim() || !instructions.trim() ||
      name.length > 120 || description.length > 500 || instructions.length > 100_000) {
      throw new RangeError("Skill name, description and instructions are required and must fit size limits");
    }
    mkdirSync(this.skillsDir, { recursive: true });
    const skillDir = path.join(this.skillsDir, id);
    try {
      mkdirSync(skillDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SkillConflictError(`Skill "${id}" already exists`);
      throw error;
    }

    const content = `---\n${stringifyYaml({ name: name.trim(), description: description.trim() })}---\n\n${instructions.trim()}\n`;
    writeFileSync(path.join(skillDir, "SKILL.md"), content, { encoding: "utf-8", flag: "wx" });
    const metadata = { id, name: name.trim(), description: description.trim() };
    this.metadata.set(id, metadata);
    return metadata;
  }
}
