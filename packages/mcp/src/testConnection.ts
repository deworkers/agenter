import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "./types.js";

export async function testMcpConnection(entry: McpServerConfig): Promise<Array<{ name: string; description: string }>> {
  const client = new Client({ name: "agenter-settings-test", version: "0.1.0" });
  try {
    const transport = entry.transport === "sse" ? new SSEClientTransport(new URL(entry.url)) : new StdioClientTransport({ command: entry.command, args: entry.args, env: entry.env });
    await client.connect(transport, { timeout: 10_000 });
    const catalog = await client.listTools({}, { timeout: 10_000 });
    return catalog.tools.map(({ name, description }) => ({ name, description: description ?? "" }));
  } finally { await client.close().catch(() => undefined); }
}
