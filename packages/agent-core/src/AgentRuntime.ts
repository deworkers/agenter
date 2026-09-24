import { buildContext } from "./ContextBuilder.js";
import type { ProviderRegistry } from "./ProviderRegistry.js";
import type { ProviderRouter, RoutingContext } from "./ProviderRouter.js";
import type {
  AgentEvent,
  AgentToolRuntime,
  ChatStorage,
  LlmMessage,
  NewToolCallInput,
  TokenUsage,
  ToolCall,
} from "./types.js";

export const MAX_TOOL_ITERATIONS = 10;

export interface AgentRuntimeOptions {
  systemPrompt?: string;
  toolRuntime?: AgentToolRuntime;
  maxToolIterations?: number;
}

export interface RunTurnOptions {
  providerId?: string;
  mode?: "manual" | "auto";
  routingContext?: RoutingContext;
  activeSkillContent?: string;
}

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const TOOL_FAILURE_MESSAGE = "Tool execution failed.";
const PROVIDER_FAILURE_MESSAGE = "Provider request failed.";
const PERSISTENCE_FAILURE_MESSAGE = "Run persistence failed.";
const INCOMPLETE_PROVIDER_MESSAGE = "Provider response ended before completion.";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addUsage(total: TokenUsage, next?: TokenUsage): void {
  if (!next) return;
  total.promptTokens += next.promptTokens;
  total.completionTokens += next.completionTokens;
}

function storedArguments(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? "null";
  } catch {
    return "null";
  }
}

export class AgentRuntime {
  private readonly systemPrompt: string;
  private readonly toolRuntime?: AgentToolRuntime;
  private readonly maxToolIterations: number;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly storage: ChatStorage,
    private readonly router: ProviderRouter,
    options: AgentRuntimeOptions = {}
  ) {
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.toolRuntime = options.toolRuntime;
    this.maxToolIterations = options.maxToolIterations ?? MAX_TOOL_ITERATIONS;
  }

  async *runTurn(chatId: string, userMessage: string, options: RunTurnOptions = {}): AsyncGenerator<AgentEvent> {
    const history = this.storage.listMessages(chatId);
    const storedUserMessage = this.storage.addMessage({ chatId, role: "user", content: userMessage });
    const toolDefinitions = this.toolRuntime?.listTools() ?? [];
    const providerId = this.resolveProviderId(options, toolDefinitions.length > 0);
    const provider = providerId ? this.registry.get(providerId) : this.registry.getDefault();
    if (!provider) {
      yield { type: "run.error", message: `Unknown provider "${providerId}"` };
      return;
    }

    const messages: LlmMessage[] = buildContext({
      systemPrompt: this.systemPrompt,
      activeSkillContent: options.activeSkillContent,
      history,
      currentMessage: userMessage,
    });
    yield { type: "run.started", provider: provider.id, model: provider.model };

    const startedAt = Date.now();
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
    const records: NewToolCallInput[] = [];
    let toolIterations = 0;
    let hasUsage = false;

    const persistError = (): boolean => {
      try {
        this.storage.completeRun({
          chatId,
          messageId: storedUserMessage.id,
          provider: provider.id,
          model: provider.model,
          status: "error",
          tokensIn: hasUsage ? usage.promptTokens : undefined,
          tokensOut: hasUsage ? usage.completionTokens : undefined,
          durationMs: Date.now() - startedAt,
        }, records);
        return true;
      } catch {
        return false;
      }
    };

    while (true) {
      let assistantText = "";
      const calls: ToolCall[] = [];
      let turnUsage: TokenUsage | undefined;
      let turnFailed: string | undefined;
      let sawDone = false;
      let callsRecordedAsSkipped = false;
      const request = {
        messages,
        ...(provider.supportsTools() && toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
      };

      try {
        for await (const event of provider.chat(request)) {
          if (event.type === "text.delta") {
            assistantText += event.text;
            yield { type: "text.delta", text: event.text };
          } else if (event.type === "tool.call") {
            calls.push(event.call);
          } else if (event.type === "done") {
            sawDone = true;
            turnUsage = event.usage;
            break;
          } else {
            turnFailed = PROVIDER_FAILURE_MESSAGE;
            break;
          }
        }
      } catch {
        turnFailed = PROVIDER_FAILURE_MESSAGE;
      }
      addUsage(usage, turnUsage);
      hasUsage ||= turnUsage !== undefined;

      if (!turnFailed && !sawDone) {
        for (const call of calls) {
          records.push({ toolName: call.name || "", arguments: storedArguments(call.arguments), result: null, status: "skipped" });
        }
        callsRecordedAsSkipped = calls.length > 0;
        turnFailed = INCOMPLETE_PROVIDER_MESSAGE;
      }

      if (turnFailed) {
        if (calls.length > 0 && !callsRecordedAsSkipped) {
          for (const call of calls) {
            records.push({ toolName: call.name || "", arguments: storedArguments(call.arguments), result: null, status: "skipped" });
          }
        }
        yield { type: "run.error", message: persistError() ? turnFailed : PERSISTENCE_FAILURE_MESSAGE };
        return;
      }

      if (calls.length === 0) {
        try {
          this.storage.completeRun({
            chatId,
            messageId: storedUserMessage.id,
            provider: provider.id,
            model: provider.model,
            status: "success",
            tokensIn: hasUsage ? usage.promptTokens : undefined,
            tokensOut: hasUsage ? usage.completionTokens : undefined,
            durationMs: Date.now() - startedAt,
          }, records, { chatId, role: "assistant", content: assistantText, provider: provider.id, model: provider.model });
        } catch {
          yield { type: "run.error", message: PERSISTENCE_FAILURE_MESSAGE };
          return;
        }
        const reportedUsage = hasUsage ? usage : turnUsage;
        yield { type: "run.completed", usage: reportedUsage };
        return;
      }

      const seenIds = new Set<string>();
      let malformedIndex = -1;
      calls.some(({ id, name, arguments: args }, index) => {
        if (!id.trim() || seenIds.has(id) || !name.trim() || !isJsonObject(args)) {
          malformedIndex = index;
          return true;
        }
        seenIds.add(id);
        try {
          const serialized = JSON.stringify(args);
          if (serialized === undefined || !isJsonObject(JSON.parse(serialized))) {
            malformedIndex = index;
            return true;
          }
          return false;
        } catch {
          malformedIndex = index;
          return true;
        }
      });
      const malformed = malformedIndex >= 0;
      if (malformed) {
        calls.forEach((call, index) => records.push({
          toolName: call.name || "",
          arguments: storedArguments(call.arguments),
          result: null,
          status: index === malformedIndex ? "error" : "skipped",
        }));
        yield { type: "run.error", message: persistError() ? TOOL_FAILURE_MESSAGE : PERSISTENCE_FAILURE_MESSAGE };
        return;
      }
      if (!this.toolRuntime || !provider.supportsTools() || toolDefinitions.length === 0) {
        calls.forEach((call, index) => records.push({
          toolName: call.name || "",
          arguments: storedArguments(call.arguments),
          result: null,
          status: index === 0 ? "error" : "skipped",
        }));
        yield { type: "run.error", message: persistError() ? "Tool calls are not enabled for this runtime." : PERSISTENCE_FAILURE_MESSAGE };
        return;
      }

      messages.push({ role: "assistant", content: assistantText || null, toolCalls: calls });
      if (toolIterations >= this.maxToolIterations) {
        for (const call of calls) records.push({ toolName: call.name, arguments: storedArguments(call.arguments), result: null, status: "skipped" });
        yield { type: "run.error", message: persistError() ? TOOL_FAILURE_MESSAGE : PERSISTENCE_FAILURE_MESSAGE };
        return;
      }

      let failed = false;
      for (let index = 0; index < calls.length; index++) {
        const call = calls[index]!;
        const argsText = storedArguments(call.arguments);
        yield { type: "tool.started", tool: call.name, arguments: call.arguments };
        try {
          const result = await this.toolRuntime.execute(call.name, call.arguments);
          const serializedResult = JSON.stringify(result);
          if (serializedResult === undefined) throw new Error(TOOL_FAILURE_MESSAGE);
          JSON.parse(serializedResult);
          records.push({ toolName: call.name, arguments: argsText, result: serializedResult, status: "success" });
          yield { type: "tool.completed", tool: call.name, result };
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: serializedResult });
        } catch {
          records.push({ toolName: call.name, arguments: argsText, result: null, status: "error" });
          for (const skipped of calls.slice(index + 1)) {
            records.push({ toolName: skipped.name, arguments: storedArguments(skipped.arguments), result: null, status: "skipped" });
          }
          failed = true;
          break;
        }
      }
      if (failed) {
        yield { type: "run.error", message: persistError() ? TOOL_FAILURE_MESSAGE : PERSISTENCE_FAILURE_MESSAGE };
        return;
      }
      toolIterations++;
    }
  }

  private resolveProviderId(options: RunTurnOptions, toolsAvailable: boolean): string | undefined {
    if (options.providerId) return options.providerId;
    if (options.mode === "auto") {
      return this.router.resolveProviderId({ ...options.routingContext, toolsRequired: toolsAvailable });
    }
    return undefined;
  }
}
