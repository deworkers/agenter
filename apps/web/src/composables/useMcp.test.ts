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
    expect(state.activeServerIds.value).toEqual([]);
    state.toggleServer("missing");
    expect(state.activeServerIds.value).toEqual([]);
    state.toggleServer("files");
    expect(state.activeServerIds.value).toEqual(["files"]);
    state.toggleServer("files");
    expect(state.activeServerIds.value).toEqual([]);
  });

  it("drops selected servers that are no longer ready after refresh", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(catalog))
      .mockResolvedValueOnce(Response.json({ servers: [{ id: "files", status: "error" }], tools: [] })));
    const state = useMcp();
    await state.refreshMcp();
    state.toggleServer("files");
    await state.refreshMcp();
    expect(state.activeServerIds.value).toEqual([]);
    state.toggleServer("files");
    expect(state.activeServerIds.value).toEqual([]);
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

  it("switches automatic links while preserving manual selections and explicit off", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ servers: [
      { id: "ddg-search", status: "ready" }, { id: "context7", status: "ready" }, { id: "gitlab", status: "ready" },
    ], tools: [] })));
    const state = useMcp(); await state.refreshMcp();
    state.toggleServer("gitlab");
    state.applySkillServers(["ddg-search"]);
    expect(state.activeServerIds.value).toEqual(["gitlab", "ddg-search"]);
    state.toggleServer("ddg-search");
    expect(state.activeServerIds.value).not.toContain("ddg-search");
    state.applySkillServers(["context7"]);
    expect(state.activeServerIds.value).toEqual(["gitlab", "context7"]);
    state.applySkillServers(["ddg-search"]);
    expect(state.activeServerIds.value).toEqual(["gitlab", "ddg-search"]);
  });

  it("restores ownership, drops unavailable links, and does not reselect on recovery", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ servers: [{ id: "context7", status: "ready" }], tools: [] }))
      .mockResolvedValueOnce(Response.json({ servers: [{ id: "context7", status: "error" }], tools: [] }))
      .mockResolvedValueOnce(Response.json({ servers: [{ id: "context7", status: "ready" }], tools: [] })));
    const state = useMcp(); await state.refreshMcp();
    state.restoreSelection(["manual"], ["context7"]);
    expect(state.activeServerIds.value).toEqual(["context7"]);
    await state.refreshMcp(); await state.refreshMcp();
    expect(state.activeServerIds.value).toEqual([]);
    expect(state.activeServerIds.value).not.toContain("context7");
  });

  it("restores chat selection opened before the initial MCP catalog arrives", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(catalog)));
    const state = useMcp();
    state.restoreSelection(["files"], []);
    await state.refreshMcp();
    expect(state.activeServerIds.value).toEqual(["files"]);
  });
});
