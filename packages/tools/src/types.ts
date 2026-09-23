export type ToolSafety = "safe" | "approval-required" | "disabled";

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  safety: ToolSafety;
  source?: { kind: "local" | "mcp"; serverId?: string };
  execute(args: unknown): Promise<unknown>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  list(): Tool[];
  get(name: string): Tool | undefined;
  execute(name: string, args: unknown): Promise<unknown>;
}
