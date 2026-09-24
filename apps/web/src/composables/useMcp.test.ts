import { afterEach, describe, expect, it, vi } from "vitest";
import { useMcp } from "./useMcp.js";

const catalog = {
  servers: [{ id: "files", status: "ready" }],
  tools: [{ name: "files__read", description: "Read a file", inputSchema: { type: "object" }, source: { kind: "mcp", serverId: "files" } }],
};

afterEach(() => vi.unstubAllGlobals());

describe("MCP catalog", () => {
  it("loads status and safe tool metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(catalog)));
    const state = useMcp();
    await state.refreshMcp();
    expect(state.servers.value).toEqual(catalog.servers);
    expect(state.tools.value).toEqual(catalog.tools);
    expect(state.error.value).toBeNull();
  });

  it("clears stale status on failure and reloads on retry", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(catalog))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(Response.json(catalog)));
    const state = useMcp();
    await state.refreshMcp();
    await state.refreshMcp();
    expect(state.servers.value).toEqual([]);
    expect(state.tools.value).toEqual([]);
    expect(state.error.value).toBe("Offline");
    await state.refreshMcp();
    expect(state.error.value).toBeNull();
    expect(state.tools.value).toEqual(catalog.tools);
  });
});
