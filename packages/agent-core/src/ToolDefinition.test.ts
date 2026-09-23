import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "./types.js";

describe("ToolDefinition", () => {
  it("preserves a plain tool description", () => {
    const definition: ToolDefinition = {
      name: "lookup",
      description: "Look up a value",
      inputSchema: { type: "object", properties: { key: { type: "string" } } },
    };

    expect(definition.name).toBe("lookup");
    expect(definition.description).toBe("Look up a value");
    expect(definition.inputSchema).toEqual({
      type: "object",
      properties: { key: { type: "string" } },
    });
  });
});
