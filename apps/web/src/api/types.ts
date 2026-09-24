// apps/web/src/api/types.ts
export type ChatRole = "system" | "user" | "assistant";

export interface ProviderSummary {
  id: string;
  model: string;
}

export interface ProvidersResponse {
  providers: ProviderSummary[];
  defaultProviderId: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
}

export interface NewSkillInput extends SkillSummary {
  instructions: string;
}

export interface RequestContext {
  systemPrompt: string;
  skill?: { id: string; content: string };
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

export interface SkillsResponse {
  skills: SkillSummary[];
}

export interface McpServerSummary {
  id: string;
  status: "ready" | "error";
}

export interface McpToolSummary {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: { kind: "mcp"; serverId: string };
}

export interface McpResponse {
  servers: McpServerSummary[];
  tools: McpToolSummary[];
}

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  role: ChatRole;
  content: string;
  provider: string | null;
  model: string | null;
  createdAt: string;
  context?: RequestContext;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export type AgentEvent =
  | { type: "run.started"; provider: string; model: string }
  | { type: "run.context"; context: RequestContext }
  | { type: "text.delta"; text: string }
  | { type: "tool.started"; tool: string; arguments: unknown }
  | { type: "tool.completed"; tool: string; result: unknown }
  | { type: "run.completed"; usage?: TokenUsage }
  | { type: "run.error"; message: string };

export interface SendMessageOptions {
  providerId?: string;
  mode?: "manual" | "auto";
  skillId?: string;
  mcpServerIds?: string[];
}

export interface ToolActivity {
  name: string;
  arguments: unknown;
  result?: unknown;
  status: "running" | "completed" | "error";
}

export interface DisplayMessage extends StoredMessage {
  tools?: ToolActivity[];
  durationMs?: number;
  error?: string;
}
