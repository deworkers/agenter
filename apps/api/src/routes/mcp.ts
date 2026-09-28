import { Router } from "express";
import type { McpManager } from "@agenter/mcp";

export function createMcpRouter(source: McpManager | (() => McpManager)): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const manager = typeof source === "function" ? source() : source;
    res.json({
      servers: manager.getServerStatus(),
      tools: manager.listTools().map(({ name, description, inputSchema, source, safety }) => ({
        name,
        description,
        inputSchema,
        safety,
        source: { kind: "mcp" as const, serverId: source.serverId },
      })),
    });
  });

  return router;
}
