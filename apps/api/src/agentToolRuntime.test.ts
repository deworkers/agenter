import { describe, expect, it, vi } from "vitest";
import { ToolRegistry, type Tool, type ToolSafety } from "@agenter/tools";
import { createAgentToolRuntime } from "./agentToolRuntime.js";

function tool(name: string, safety: ToolSafety, execute = vi.fn(async (args: unknown) => args)): Tool {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: { value: { type: "string" } } },
    safety,
    execute,
  };
}

describe("createAgentToolRuntime", () => {
  it("exposes only safe definitions and delegates execution to the shared registry", async () => {
    const registry = new ToolRegistry();
    const safeExecute = vi.fn(async (args: unknown) => ({ echoed: args }));
    registry.register(tool("safe_tool", "safe", safeExecute));
    registry.register(tool("approval_tool", "approval-required"));
    registry.register(tool("disabled_tool", "disabled"));
    const runtime = createAgentToolRuntime(registry);

    expect(runtime.listTools()).toEqual([
      {
        name: "safe_tool",
        description: "safe_tool description",
        inputSchema: { type: "object", properties: { value: { type: "string" } } },
      },
    ]);

    await expect(runtime.execute("safe_tool", { value: "hello" })).resolves.toEqual({
      echoed: { value: "hello" },
    });
    expect(safeExecute).toHaveBeenCalledWith({ value: "hello" });
    await expect(runtime.execute("approval_tool", {})).rejects.toThrow(/not safe to execute/);
  });
});
