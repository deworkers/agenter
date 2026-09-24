import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "../../tools/src/ToolRegistry.js";
import { McpManager } from "./McpManager.js";

const sdk = vi.hoisted(() => ({
  clients: [] as Array<{ connect: ReturnType<typeof vi.fn>; listTools: ReturnType<typeof vi.fn>; callTool: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>,
  transports: [] as Array<{ command: string; args: string[]; options: unknown }>,
  sseUrls: [] as string[],
  tools: [] as unknown[],
  callResult: { content: [{ type: "text", text: "ok" }] } as unknown,
  connectErrors: new Map<number, Error>(),
  listErrors: new Map<number, Error>(),
  closeErrors: new Map<number, Error>(),
  catalogs: new Map<number, unknown[]>(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    private readonly index = sdk.clients.length;
    connect = vi.fn(async () => {
      const error = sdk.connectErrors.get(this.index);
      if (error) throw error;
    });
    listTools = vi.fn(async () => {
      const error = sdk.listErrors.get(this.index);
      if (error) throw error;
      return { tools: sdk.catalogs.get(this.index) ?? sdk.tools };
    });
    callTool = vi.fn(async () => sdk.callResult);
    close = vi.fn(async () => {
      const error = sdk.closeErrors.get(this.index);
      if (error) throw error;
    });
    constructor() { sdk.clients.push(this); }
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor(options: { command: string; args?: string[] }) {
      this.command = options.command;
      this.args = options.args ?? [];
      sdk.transports.push({ command: this.command, args: this.args, options });
    }
    command: string;
    args: string[];
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    constructor(url: URL) { sdk.sseUrls.push(url.toString()); }
  },
}));

afterEach(() => {
  sdk.clients.length = 0;
  sdk.transports.length = 0;
  sdk.sseUrls.length = 0;
  sdk.tools.length = 0;
  sdk.callResult = { content: [{ type: "text", text: "ok" }] };
  sdk.connectErrors.clear();
  sdk.listErrors.clear();
  sdk.closeErrors.clear();
  sdk.catalogs.clear();
});

describe("McpManager", () => {
  it("connects an SSE server and registers its namespaced tools", async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    sdk.tools.push({ name: "search", description: "Search", inputSchema: { type: "object" } });

    await manager.start({ remote: { transport: "sse", url: "http://127.0.0.1:8001/servers/ddg-search/sse" } });

    expect(sdk.sseUrls).toEqual(["http://127.0.0.1:8001/servers/ddg-search/sse"]);
    expect(sdk.transports).toEqual([]);
    expect(manager.getServerStatus()).toEqual([{ id: "remote", status: "ready" }]);
    expect(registry.get("remote__search")).toMatchObject({ safety: "safe", source: { kind: "mcp", serverId: "remote" } });
  });

  it("keeps later stdio servers available when an SSE connection fails", async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    sdk.connectErrors.set(0, new Error("unavailable"));
    sdk.tools.push({ name: "healthy", inputSchema: { type: "object" } });

    await manager.start({
      remote: { transport: "sse", url: "http://127.0.0.1:8001/servers/ddg-search/sse" },
      local: { command: "local-server" },
    });

    expect(manager.getServerStatus()).toEqual([{ id: "remote", status: "error" }, { id: "local", status: "ready" }]);
    expect(registry.get("local__healthy")).toBeDefined();
    expect(sdk.clients[0]?.close).toHaveBeenCalledOnce();
  });

  it("connects over stdio, registers namespaced safe tools and invokes the MCP tool", async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    const inputSchema = { type: "object", properties: { query: { type: "string" } } };
    sdk.tools.push({ name: "search", description: "Find things", inputSchema });
    // Client instances are constructed when start() runs; configure SDK response on its mock.
    const starting = manager.start({ local: { command: "mcp-server", args: ["--stdio"] } });
    await starting;
    expect(sdk.transports).toEqual([expect.objectContaining({ command: "mcp-server", args: ["--stdio"] })]);
    expect(registry.get("local__search")).toMatchObject({ safety: "safe", source: { kind: "mcp", serverId: "local" } });
    expect(await registry.execute("local__search", { query: "hello" })).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(sdk.clients).toHaveLength(1);
    expect(sdk.clients[0]?.callTool).toHaveBeenCalledWith({ name: "search", arguments: { query: "hello" } });
  });

  it("accepts an omitted MCP tool description and normalizes it to an empty string", async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    sdk.tools.push({ name: "search", inputSchema: { type: "object" } });

    await manager.start({ local: { command: "mcp-server" } });

    expect(registry.get("local__search")).toMatchObject({ name: "local__search", description: "" });
    expect(manager.getServerStatus()).toEqual([{ id: "local", status: "ready" }]);
  });

  it("passes explicit env overrides without forwarding unrelated parent environment", async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    const sentinelName = "AGENTER_MCP_PARENT_ENV_SENTINEL";
    const previousSentinel = process.env[sentinelName];
    process.env[sentinelName] = "sentinel-value";

    try {
      await manager.start({ local: { command: "mcp-server", env: { AGENTER_MCP_EXPLICIT_OVERRIDE: "explicit-value" } } });

      const options = sdk.transports[0]?.options as { env?: Record<string, string> } | undefined;
      expect(options?.env).toMatchObject({ AGENTER_MCP_EXPLICIT_OVERRIDE: "explicit-value" });
      expect(options?.env).not.toHaveProperty(sentinelName);
    } finally {
      if (previousSentinel === undefined) delete process.env[sentinelName];
      else process.env[sentinelName] = previousSentinel;
    }
  });

  it("rejects MCP tool error results without exposing result content or secrets", async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    const rawContent = "upstream failure with secret-value";
    sdk.tools.push({ name: "search", description: "Find things", inputSchema: { type: "object" } });
    sdk.callResult = { isError: true, content: [{ type: "text", text: rawContent }] };

    await manager.start({ local: { command: "mcp-server" } });
    const error = await registry.execute("local__search", {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("local__search");
    expect((error as Error).message).not.toContain(rawContent);
    expect((error as Error).message).not.toContain("secret-value");
  });

  it.each([
    ["empty name", { name: "", description: "tool", inputSchema: { type: "object" } }],
    ["non-string description", { name: "tool", description: 3, inputSchema: { type: "object" } }],
    ["non-plain schema", { name: "tool", description: "tool", inputSchema: [] }],
    ["non-JSON schema", { name: "tool", description: "tool", inputSchema: { value: Number.NaN } }],
  ])("rejects %s metadata without partial registration", async (_case, tool) => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    sdk.tools.push(tool);
    await expect(manager.start({ broken: { command: "server" } })).resolves.toBeUndefined();
    expect(manager.getServerStatus()).toEqual([{ id: "broken", status: "error" }]);
    expect(registry.list()).toEqual([]);
    void tool;
  });

  it("rejects duplicate discovered names and existing registry collisions", async () => {
    const registry = new ToolRegistry();
    registry.register({ name: "server__tool", description: "existing", inputSchema: {}, safety: "safe", execute: async () => null });
    const manager = new McpManager(registry);
    sdk.tools.push({ name: "tool", description: "tool", inputSchema: { type: "object" } });
    await expect(manager.start({ server: { command: "server" } })).resolves.toBeUndefined();
    expect(manager.getServerStatus()).toEqual([{ id: "server", status: "error" }]);
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects duplicate discovered names before registering any tool", async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    sdk.tools.push(
      { name: "repeat", description: "first", inputSchema: { type: "object" } },
      { name: "repeat", description: "second", inputSchema: { type: "object" } },
    );

    await expect(manager.start({ server: { command: "server" } })).resolves.toBeUndefined();
    expect(manager.getServerStatus()).toEqual([{ id: "server", status: "error" }]);
    expect(registry.list()).toEqual([]);
  });

  it.each(["connect", "listTools"] as const)("isolates a %s failure and starts healthy servers", async (stage) => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    sdk.tools.push({ name: "healthy-tool", description: "usable", inputSchema: { type: "object" } });
    (stage === "connect" ? sdk.connectErrors : sdk.listErrors).set(0, new Error("secret config value"));

    await expect(manager.start({ broken: { command: "broken" }, healthy: { command: "healthy" } })).resolves.toBeUndefined();

    expect(manager.getServerStatus()).toEqual([{ id: "broken", status: "error" }, { id: "healthy", status: "ready" }]);
    expect(registry.get("healthy__healthy-tool")).toBeDefined();
    expect(await registry.execute("healthy__healthy-tool", {})).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(sdk.clients[0]?.close).toHaveBeenCalledOnce();
  });

  it("isolates an invalid catalog so later servers can start", async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    sdk.catalogs.set(0, [{ name: "", description: "invalid", inputSchema: { type: "object" } }]);
    sdk.catalogs.set(1, [{ name: "healthy-tool", description: "usable", inputSchema: { type: "object" } }]);

    await expect(manager.start({ broken: { command: "broken" }, healthy: { command: "healthy" } })).resolves.toBeUndefined();

    expect(manager.getServerStatus()).toEqual([{ id: "broken", status: "error" }, { id: "healthy", status: "ready" }]);
    expect(registry.get("broken__")).toBeUndefined();
    expect(registry.get("healthy__healthy-tool")).toBeDefined();
    expect(sdk.clients[0]?.close).toHaveBeenCalledOnce();
  });

  it("closes every session despite close failures and supports repeated stop", async () => {
    const registry = new ToolRegistry();
    const manager = new McpManager(registry);
    sdk.tools.push({ name: "tool", description: "tool", inputSchema: { type: "object" } });
    await manager.start({ broken: { command: "broken" }, healthy: { command: "healthy" } });
    sdk.closeErrors.set(0, new Error("close failed"));

    await expect(manager.stop()).resolves.toBeUndefined();
    await expect(manager.stop()).resolves.toBeUndefined();

    expect(sdk.clients[0]?.close).toHaveBeenCalledOnce();
    expect(sdk.clients[1]?.close).toHaveBeenCalledOnce();
  });
});
