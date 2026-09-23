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
