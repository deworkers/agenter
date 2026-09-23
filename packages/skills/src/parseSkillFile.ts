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
