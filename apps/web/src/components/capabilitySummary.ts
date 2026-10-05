import type { McpServerSummary, McpToolSummary } from "../api/types.js";

export function summarizeActiveMcp(
  servers: McpServerSummary[],
  tools: McpToolSummary[],
  activeServerIds: string[],
): { serverCount: number; safeToolCount: number } {
  const selectedReadyServers = new Set(
    servers
      .filter((server) => server.status === "ready" && activeServerIds.includes(server.id))
      .map((server) => server.id),
  );

  return {
    serverCount: selectedReadyServers.size,
    safeToolCount: tools.filter((tool) => tool.safety === "safe" && selectedReadyServers.has(tool.source.serverId)).length,
  };
}
