export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RequestContext {
  systemPrompt: string;
  skill?: { id: string; content: string };
  tools: ToolDefinition[];
}

export interface ToolCall { id: string; name: string; arguments: unknown }
export interface AssistantToolCallMessage { role: "assistant"; content: string | null; toolCalls: ToolCall[] }
export interface ToolResultMessage { role: "tool"; toolCallId: string; name: string; content: string }
export type LlmMessage = ChatMessage | AssistantToolCallMessage | ToolResultMessage;
export interface AgentToolRuntime {
  listTools(): ToolDefinition[];
  execute(name: string, args: unknown): Promise<unknown>;
}
export type ToolCallStatus = "success" | "error" | "skipped";
export interface NewToolCallInput { toolName: string; arguments: string; result: string | null; status: ToolCallStatus }
export interface ToolCallRecord extends NewToolCallInput { id: string; runId: string; createdAt: string }

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmRequest {
  messages: LlmMessage[];
  tools?: ToolDefinition[];
}

export type LlmEvent =
  | { type: "text.delta"; text: string }
  | { type: "tool.call"; call: ToolCall }
  | { type: "done"; usage?: TokenUsage }
  | { type: "error"; message: string };

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  chat(request: LlmRequest): AsyncIterable<LlmEvent>;
  supportsTools(): boolean;
  supportsVision(): boolean;
  getContextWindow(): number;
}

export type AgentEvent =
  | { type: "run.started"; provider: string; model: string }
  | { type: "run.context"; context: RequestContext }
  | { type: "text.delta"; text: string }
  | { type: "tool.started"; tool: string; arguments: unknown }
  | { type: "tool.completed"; tool: string; result: unknown }
  | { type: "run.completed"; usage?: TokenUsage }
  | { type: "run.error"; message: string };

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

export interface NewMessageInput {
  chatId: string;
  role: ChatRole;
  content: string;
  provider?: string;
  model?: string;
  context?: RequestContext;
}

export interface RunRecord {
  id: string;
  chatId: string;
  messageId: string;
  provider: string;
  model: string;
  status: "success" | "error";
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number;
  createdAt: string;
}

export interface NewRunInput {
  chatId: string;
  messageId: string;
  provider: string;
  model: string;
  status: "success" | "error";
  tokensIn?: number;
  tokensOut?: number;
  durationMs: number;
}

export interface ChatStorage {
  createChat(title: string): Chat;
  listChats(): Chat[];
  getChat(id: string): Chat | undefined;
  deleteChat(id: string): void;
  touchChat(id: string): void;

  listMessages(chatId: string): StoredMessage[];
  addMessage(input: NewMessageInput): StoredMessage;

  addRun(input: NewRunInput): RunRecord;
  completeRun(
    input: NewRunInput,
    toolCalls: NewToolCallInput[],
    assistantMessage?: NewMessageInput
  ): RunRecord;
}
