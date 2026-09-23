import { describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "./ToolRegistry.js";
import type { Tool } from "./types.js";

function fixtureTool(name: string, overrides: Partial<Tool> = {}): Tool {
  return {
    name,
    description: `Fixture tool ${name}`,
    inputSchema: {},
    safety: "safe",
    execute: vi.fn(async (args: unknown) => args),
    ...overrides,
  };
}

describe("ToolRegistry", () => {
  it("retrieves a registered tool by its exact name", () => {
    const registry = new ToolRegistry();
    const tool = fixtureTool("read_file");
    registry.register(tool);

    expect(registry.get("read_file")).toBe(tool);
    expect(registry.get("Read_file")).toBeUndefined();
  });

  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();
    registry.register(fixtureTool("search"));

    expect(() => registry.register(fixtureTool("search"))).toThrow(/search/);
  });

  it("lists tools in deterministic alphabetical order", () => {
    const registry = new ToolRegistry();
    const zebra = fixtureTool("zebra");
    const alpha = fixtureTool("alpha");
    const middle = fixtureTool("middle");
    registry.register(zebra);
    registry.register(alpha);
    registry.register(middle);

    expect(registry.list()).toEqual([alpha, middle, zebra]);
  });

  it("lists names in locale-independent ordinal order", () => {
    const registry = new ToolRegistry();
    const names = ["éclair", "zebra", "äther", "apple", "Apple"];
    const tools = names.map((name) => fixtureTool(name));
    tools.forEach((tool) => registry.register(tool));

    expect(registry.list()).toEqual(["Apple", "apple", "zebra", "äther", "éclair"].map((name) => tools.find((tool) => tool.name === name)));
  });

  it("rejects an unknown name without invoking a registered tool", async () => {
    const registry = new ToolRegistry();
    const registered = fixtureTool("safe_tool");
    registry.register(registered);

    await expect(registry.execute("unregistered_tool", { command: "do not run" })).rejects.toThrow(/unregistered_tool/);
    expect(registered.execute).not.toHaveBeenCalled();
  });

  it("rejects disabled tools without executing them", async () => {
    const registry = new ToolRegistry();
    const disabled = fixtureTool("disabled_tool", { safety: "disabled" });
    registry.register(disabled);

    await expect(registry.execute("disabled_tool", {})).rejects.toThrow(/disabled_tool/);
    expect(disabled.execute).not.toHaveBeenCalled();
  });

  it("rejects approval-required tools without authorization", async () => {
    const registry = new ToolRegistry();
    const approvalRequired = fixtureTool("delete_file", { safety: "approval-required" });
    registry.register(approvalRequired);

    await expect(registry.execute("delete_file", {})).rejects.toThrow(/delete_file/);
    expect(approvalRequired.execute).not.toHaveBeenCalled();
  });

  it("rejects tools with an unrecognized runtime safety value", async () => {
    const registry = new ToolRegistry();
    const invalidSafety = fixtureTool("invalid_safety", { safety: "unrecognized" as Tool["safety"] });
    registry.register(invalidSafety);

    await expect(registry.execute("invalid_safety", {})).rejects.toThrow(/invalid_safety/);
    expect(invalidSafety.execute).not.toHaveBeenCalled();
  });

  it("executes a safe registered tool with unknown arguments and returns its result", async () => {
    const registry = new ToolRegistry();
    const args = { unexpected: [1, "value"] };
    const result = { accepted: true };
    const tool = fixtureTool("inspect", { execute: vi.fn(async (received: unknown) => received === args ? result : null) });
    registry.register(tool);

    await expect(registry.execute("inspect", args)).resolves.toBe(result);
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(tool.execute).toHaveBeenCalledWith(args);
  });

  it("identifies the requested tool in errors without echoing argument secrets", async () => {
    const registry = new ToolRegistry();
    const secret = "sensitive-argument-value";

    const error = await registry.execute("missing_tool", { secret }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("missing_tool");
    expect((error as Error).message).not.toContain(secret);
  });

  it("identifies a safe tool whose execution fails without leaking its error secret", async () => {
    const registry = new ToolRegistry();
    const secret = "sensitive-execution-detail";
    const tool = fixtureTool("safe_failure", {
      execute: vi.fn(async () => {
        throw new Error(`internal failure: ${secret}`);
      }),
    });
    registry.register(tool);

    const error = await registry.execute("safe_failure", {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("safe_failure");
    expect((error as Error).message).not.toContain(secret);
    expect(tool.execute).toHaveBeenCalledOnce();
  });
});
