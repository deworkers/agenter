import { Router } from "express";
import type { McpManager } from "@agenter/mcp";

export function createMcpRouter(manager: McpManager): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      servers: manager.getServerStatus(),
      tools: manager.listTools().map(({ name, description, inputSchema, source }) => ({
        name,
        description,
        inputSchema,
        source: { kind: "mcp" as const, serverId: source.serverId },
      })),
    });
  });

  return router;
}
