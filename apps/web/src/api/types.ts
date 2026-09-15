// apps/web/src/api/types.ts
export type ChatRole = "system" | "user" | "assistant";

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
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export type AgentEvent =
  | { type: "run.started"; provider: string; model: string }
  | { type: "text.delta"; text: string }
  | { type: "run.completed"; usage?: TokenUsage }
  | { type: "run.error"; message: string };
