import { describe, expect, it, vi } from "vitest";
import type { Tool } from "@agenter/tools";
import { buildLocalToolRegistry } from "./localTools.js";

const echoTool: Tool = {
  name: "echo",
  description: "Returns the supplied value.",
  inputSchema: { type: "object" },
  safety: "safe",
  source: { kind: "local" },
  async execute(args) {
    return args;
  },
};

describe("buildLocalToolRegistry", () => {
  it("registers and executes only explicitly enabled local tools", async () => {
    const registry = buildLocalToolRegistry([echoTool]);

    expect(registry.list()).toEqual([echoTool]);
    expect(registry.get("echo")).toEqual(echoTool);
    expect(registry.get("echo")?.source).toEqual({ kind: "local" });
    await expect(registry.execute("echo", { message: "hello" })).resolves.toEqual({ message: "hello" });
    await expect(registry.execute("unlisted", {})).rejects.toThrow('Tool "unlisted" is not registered.');
  });

  it("starts empty when no local tools are explicitly enabled", () => {
    expect(buildLocalToolRegistry().list()).toEqual([]);
  });

  it.each(["disabled", "approval-required"] as const)("keeps %s tools non-executable", async (safety) => {
    const tool: Tool = { ...echoTool, safety };
    const registry = buildLocalToolRegistry([tool]);

    expect(registry.get("echo")).toBe(tool);
    await expect(registry.execute("echo", {})).rejects.toThrow('Tool "echo" is not safe to execute.');
  });

  it.each([
    { label: "MCP", source: { kind: "mcp" as const, serverId: "remote-server" } },
    { label: "missing", source: undefined },
  ])("rejects $label source tools before execution", ({ source }) => {
    const execute = vi.fn(async (args: unknown) => args);
    const tool: Tool = { ...echoTool, source, execute };

    expect(() => buildLocalToolRegistry([tool])).toThrow('Tool "echo" is not a local tool.');
    expect(execute).not.toHaveBeenCalled();
  });
});
