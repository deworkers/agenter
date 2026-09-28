// packages/skills/src/SkillRegistry.ts
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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

      const raw = readFileSync(skillFilePath, "utf-8");
      const { name, description, enabled } = parseSkillFile(raw);
      this.metadata.set(entry.name, { id: entry.name, name, description, ...(enabled === false ? { enabled: false } : {}) });
    }
  }

  list(): SkillMetadata[] {
    return [...this.metadata.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getContent(id: string): string | undefined {
    if (!this.metadata.has(id) || this.metadata.get(id)?.enabled === false) return undefined;

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

  get(id: string): NewSkillInput | undefined {
    const metadata = this.metadata.get(id);
    if (!metadata) return undefined;
    const { body } = parseSkillFile(readFileSync(this.skillPath(id), "utf8"));
    return { ...metadata, instructions: body.trimEnd() };
  }

  update(input: NewSkillInput): SkillMetadata {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id) || !this.metadata.has(input.id)) throw new RangeError("Unknown skill id");
    if (!input.name.trim() || !input.description.trim() || !input.instructions.trim() || input.name.length > 120 || input.description.length > 500 || input.instructions.length > 100_000 || (input.enabled !== undefined && typeof input.enabled !== "boolean")) throw new RangeError("Invalid skill fields or size limits");
    const target = this.skillPath(input.id);
    const metadata = { id: input.id, name: input.name.trim(), description: input.description.trim(), ...(input.enabled === false ? { enabled: false } : {}) };
    const content = `---\n${stringifyYaml({ name: metadata.name, description: metadata.description, ...(input.enabled === false ? { enabled: false } : {}) })}---\n\n${input.instructions.trim()}\n`;
    writeFileSync(`${target}.tmp`, content, "utf8");
    copyFileSync(target, `${target}.bak`);
    renameSync(`${target}.tmp`, target);
    this.metadata.set(input.id, metadata);
    return metadata;
  }

  remove(id: string): void {
    if (!this.metadata.has(id)) throw new RangeError("Unknown skill id");
    const target = this.skillPath(id);
    if (existsSync(`${target}.bak`)) unlinkSync(`${target}.bak`);
    renameSync(target, `${target}.bak`);
    this.metadata.delete(id);
  }

  private skillPath(id: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new RangeError("Invalid skill id");
    const directory = path.join(this.skillsDir, id);
    if (lstatSync(directory).isSymbolicLink()) throw new RangeError("Symbolic link skills cannot be edited");
    const target = path.join(directory, "SKILL.md");
    if (lstatSync(target).isSymbolicLink()) throw new RangeError("Symbolic link skills cannot be edited");
    return target;
  }
}
