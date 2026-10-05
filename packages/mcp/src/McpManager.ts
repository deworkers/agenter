import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool, ToolRegistry } from "@agenter/tools";
import type { McpServerConfig, McpServerStatus } from "./types.js";
import { gitlabReviewSchema, isGitlabReviewTool, validateGitlabReviewCall } from "./gitlabReview.js";

type McpTool = {
  name: unknown;
  description?: unknown;
  inputSchema: unknown;
};

type Session = { client?: Client; status: McpServerStatus["status"] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : isPlainObject(value) && Object.values(value).every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function isValidTool(tool: McpTool): tool is McpTool & { name: string; description?: string; inputSchema: Record<string, unknown> } {
  return typeof tool.name === "string" && tool.name.trim().length > 0
    && (tool.description === undefined || typeof tool.description === "string")
    && isPlainObject(tool.inputSchema)
    && isJsonValue(tool.inputSchema);
}

export class McpManager {
  private readonly sessions = new Map<string, Session>();
  private readonly tools = new Map<string, Tool & { source: { kind: "mcp"; serverId: string } }>();

  constructor(private readonly registry: ToolRegistry) {}

  async start(config: Record<string, McpServerConfig>): Promise<void> {
    for (const [serverId, serverConfig] of Object.entries(config)) {
      const client = new Client({ name: "agenter", version: "0.1.0" });
      const transport = serverConfig.transport === "sse"
        ? new SSEClientTransport(new URL(serverConfig.url))
        : new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env,
        });
      try {
        await client.connect(transport, { timeout: 10_000 });
        const response = await client.listTools({}, { timeout: 10_000 });
        const discovered = response.tools as McpTool[];
        const seen = new Set<string>();
        const adapted = discovered.filter(tool => serverConfig.safetyProfile !== "gitlab-review" || (typeof tool.name === "string" && isGitlabReviewTool(tool.name))).map((tool) => {
          if (!isValidTool(tool) || seen.has(tool.name)) throw new Error("Invalid MCP tool catalog.");
          seen.add(tool.name);
          const name = `${serverId}__${tool.name}`;
          if (this.registry.get(name)) throw new Error("MCP tool name collision.");
          return {
            name,
            description: serverConfig.safetyProfile === "gitlab-review" && tool.name === "update_merge_request"
              ? "Update ONLY the description of an existing merge request. Title, branches, state and other settings cannot be changed. GitLab quick actions are prohibited."
              : tool.description ?? "",
            inputSchema: serverConfig.safetyProfile === "gitlab-review" ? gitlabReviewSchema(tool.name, tool.inputSchema) : tool.inputSchema,
            safety: serverConfig.allowedTools === undefined || serverConfig.allowedTools.includes(tool.name) ? "safe" as const : "disabled" as const,
            source: { kind: "mcp" as const, serverId },
            execute: async (args: unknown, signal?: AbortSignal) => {
              if (serverConfig.safetyProfile === "gitlab-review") validateGitlabReviewCall(tool.name, args);
              const result = await client.callTool({ name: tool.name, arguments: args as Record<string, unknown> }, undefined, { signal, timeout: 120_000 });
              if (result.isError) throw new Error(`MCP tool "${name}" failed.`);
              return result;
            },
          };
        });
        for (const tool of adapted) {
          this.registry.register(tool);
          this.tools.set(tool.name, tool);
        }
        this.sessions.set(serverId, { client, status: "ready" });
      } catch {
        await client.close().catch(() => undefined);
        this.sessions.set(serverId, { status: "error" });
      }
    }
  }

  listTools(): Array<Tool & { source: { kind: "mcp"; serverId: string } }> {
    return [...this.tools.values()];
  }

  getServerStatus(): McpServerStatus[] {
    return [...this.sessions].map(([id, session]) => ({ id, status: session.status }));
  }

  async stop(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.flatMap(({ client }) => client ? [client.close()] : []));
  }
}
