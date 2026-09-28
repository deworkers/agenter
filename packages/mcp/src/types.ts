export interface StdioMcpServerConfig {
  allowedTools?: string[];
  transport?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SseMcpServerConfig {
  allowedTools?: string[];
  transport: "sse";
  url: string;
}

export type McpServerConfig = StdioMcpServerConfig | SseMcpServerConfig;

export interface McpServerStatus {
  id: string;
  status: "ready" | "error";
}
