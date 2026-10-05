export interface StdioMcpServerConfig {
  safetyProfile?: "gitlab-review";
  allowedTools?: string[];
  transport?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SseMcpServerConfig {
  safetyProfile?: "gitlab-review";
  allowedTools?: string[];
  transport: "sse";
  url: string;
}

export type McpServerConfig = StdioMcpServerConfig | SseMcpServerConfig;

export interface McpServerStatus {
  id: string;
  status: "ready" | "error";
}
