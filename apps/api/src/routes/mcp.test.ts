import express from "express";
import { describe, expect, it } from "vitest";
import type { McpManager } from "@agenter/mcp";
import { createMcpRouter } from "./mcp.js";

describe("MCP status route", () => {
  it("returns server statuses and only redacted tool metadata", async () => {
    const tool = {
      name: "server__lookup",
      description: "Find an item",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      source: { kind: "mcp" as const, serverId: "server" },
      command: "secret-command",
      args: ["secret-argument"],
      env: { TOKEN: "sentinel-secret" },
      secret: "sentinel-secret",
      execute: async () => "must not serialize",
    };
    const manager = {
      getServerStatus: () => [
        { id: "server", status: "ready" as const },
        { id: "broken", status: "error" as const },
      ],
      listTools: () => [tool],
    } as unknown as McpManager;
    const app = express();
    app.use(createMcpRouter(manager));
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected loopback TCP address");

      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        servers: [
          { id: "server", status: "ready" },
          { id: "broken", status: "error" },
        ],
        tools: [{
          name: "server__lookup",
          description: "Find an item",
          inputSchema: tool.inputSchema,
          source: { kind: "mcp", serverId: "server" },
        }],
      });
      const serialized = JSON.stringify(body);
      for (const forbidden of ["command", "args", "env", "secret", "execute", "sentinel-secret", "secret-command", "secret-argument"]) {
        expect(serialized).not.toContain(forbidden);
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
