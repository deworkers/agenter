export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServerStatus {
  id: string;
  status: "ready" | "error";
}
