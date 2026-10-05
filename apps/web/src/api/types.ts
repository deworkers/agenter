// apps/web/src/api/types.ts
import type { TextAttachment, ResponseFormat } from "@agenter/agent-core";
export type { TextAttachment, ResponseFormat } from "@agenter/agent-core";
export type ChatRole = "system" | "user" | "assistant";

export interface ProviderSummary {
  id: string;
  model: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  label?: string;
}

export interface ProvidersResponse {
  providers: ProviderSummary[];
  defaultProviderId: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  enabled?: boolean;
  mcpServers?: string[];
}

export interface NewSkillInput extends SkillSummary {
  instructions: string;
}

export interface RequestContext {
  systemPrompt: string;
  skill?: { id: string; content: string };
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  budget?: ContextBudget;
}

export interface ContextBudget {
  contextWindow: number; outputReserve: number; usedTokens: number; availableTokens: number;
  estimated: true; overLimit: boolean;
  breakdown: { system: number; skill: number; tools: number; history: number; message: number; results: number };
}
export interface ModelSettings {
  type: "openai-compatible"; baseUrl: string; apiKey: string; model: string;
  label?: string; contextWindow?: number; maxOutputTokens?: number; timeoutMs?: number;
  supportsTools?: boolean; enabled?: boolean;
}
export interface ServerSettings {
  safetyProfile?: "gitlab-review";
  transport?: "stdio" | "sse"; url?: string; command?: string; args?: string[];
  env?: Record<string, string>; allowedTools?: string[]; enabled?: boolean;
}
export interface Settings {
  version: 1; systemPrompt: string; defaultProvider: string; providers: Record<string, ModelSettings>;
  routes: Record<string, { provider: string }>; mcpServers: Record<string, ServerSettings>;
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
  safety?: "safe" | "disabled" | "approval-required";
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
  attachments?: TextAttachment[];
  responseFormat?: ResponseFormat;
  provider: string | null;
  model: string | null;
  createdAt: string;
  context?: RequestContext;
  tools?: ToolActivity[];
  durationMs?: number;
  usage?: TokenUsage;
  error?: string;
  errorCode?: "cancelled" | "timeout" | "provider_unavailable" | "invalid_response" | "context_over_limit" | "tool_not_allowed" | "tool_failed" | "tool_unavailable" | "tool_invalid_result" | "tool_result_too_large" | "incomplete_response" | "persistence_failed";
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface CompactResult {
  summary: string; provider: string; model: string; compactedMessages: number;
  beforeTokens: number; afterTokens: number; usage?: TokenUsage;
}

export type AgentEvent =
  | { type: "run.started"; provider: string; model: string }
  | { type: "run.phase"; stage: "waiting" | "checking" }
  | { type: "run.context"; context: RequestContext }
  | { type: "text.delta"; text: string }
  | { type: "text.reset" }
  | { type: "tool.started"; tool: string; arguments: unknown }
  | { type: "tool.completed"; tool: string; result: unknown }
  | { type: "tool.failed"; tool: string; code: "tool_unavailable" }
  | { type: "run.completed"; usage?: TokenUsage }
  | { type: "run.error"; message: string; code?: NonNullable<StoredMessage["errorCode"]> };

export interface SendMessageOptions {
  attachments?: TextAttachment[];
  responseFormat?: ResponseFormat;
  providerId?: string;
  mode?: "manual" | "auto";
  skillId?: string;
  mcpServerIds?: string[];
  historyLimit?: number;
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
  runPhase?: "waiting" | "receiving" | "tool" | "checking" | "completed" | "error";
  currentTool?: string;
  provisional?: boolean;
  runStartedAt?: number;
}
