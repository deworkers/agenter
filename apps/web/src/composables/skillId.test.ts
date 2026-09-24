import { describe, expect, it } from "vitest";
import { skillIdFromName } from "./skillId.js";

describe("skillIdFromName", () => {
  it("makes readable ids from Russian and Latin names", () => {
    expect(skillIdFromName("Редактор текста")).toBe("redaktor-teksta");
    expect(skillIdFromName("Code Review 2")).toBe("code-review-2");
  });
});
