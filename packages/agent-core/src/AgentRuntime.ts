import { buildContext } from "./ContextBuilder.js";
import { estimateContext, estimateTokens } from "./ContextBudget.js";
import { summarizeConversation } from "./ConversationCompactor.js";
import { messageText, responseInstructions, validateAttachments } from "./TextAttachments.js";
import type { ProviderRegistry } from "./ProviderRegistry.js";
import type { ProviderRouter, RoutingContext } from "./ProviderRouter.js";
import type {
  AgentEvent,
  AgentToolRuntime,
  ChatStorage,
  LlmMessage,
  NewToolCallInput,
  RequestContext,
  TokenUsage,
  ToolCall,
  ContextCheckpointStorage,
  CompactResult,
  StoredMessage,
  TextAttachment,
  ResponseFormat,
} from "./types.js";

export const MAX_TOOL_ITERATIONS = 10;

export interface AgentRuntimeOptions {
  systemPrompt?: string;
  toolRuntime?: AgentToolRuntime;
  maxToolIterations?: number;
  contextStorage?: ContextCheckpointStorage;
}

export interface RunTurnOptions {
  attachments?: TextAttachment[];
  responseFormat?: ResponseFormat;
  providerId?: string;
  mode?: "manual" | "auto";
  routingContext?: RoutingContext;
  activeSkillContent?: string;
  activeSkillId?: string;
  allowedToolNames?: readonly string[];
  signal?: AbortSignal;
  historyLimit?: number;
}

export const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
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
  private readonly contextStorage?: ContextCheckpointStorage;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly storage: ChatStorage,
    private readonly router: ProviderRouter,
    options: AgentRuntimeOptions = {}
  ) {
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.toolRuntime = options.toolRuntime;
    this.maxToolIterations = options.maxToolIterations ?? MAX_TOOL_ITERATIONS;
    this.contextStorage = options.contextStorage;
  }

  async *runTurn(chatId: string, userMessage: string, options: RunTurnOptions = {}): AsyncGenerator<AgentEvent> {
    const attachments = validateAttachments(options.attachments);
    const currentMessage = messageText(userMessage, attachments);
    const outputInstructions = responseInstructions(options.responseFormat);
    const systemPrompt = [this.systemPrompt, outputInstructions].filter(Boolean).join("\n\n");
    const history = this.turnHistory(chatId, options.historyLimit);
    const allowedToolNames = options.allowedToolNames === undefined ? undefined : new Set(options.allowedToolNames);
    const toolDefinitions = (this.toolRuntime?.listTools() ?? [])
      .filter(({ name }) => allowedToolNames === undefined || allowedToolNames.has(name));
    const offeredToolNames = new Set(toolDefinitions.map(({ name }) => name));
    const providerId = this.resolveProviderId(options, toolDefinitions.length > 0);
    const provider = providerId ? this.registry.get(providerId) : this.registry.getDefault();
    const context: RequestContext | undefined = provider ? {
      systemPrompt,
      ...(options.activeSkillContent !== undefined ? {
        skill: { id: options.activeSkillId ?? "", content: options.activeSkillContent },
      } : {}),
      tools: provider.supportsTools() ? toolDefinitions : [],
    } : undefined;
    if (context && provider) context.budget = estimateContext({ systemPrompt, activeSkillContent: options.activeSkillContent, tools: context.tools, history, currentMessage, contextWindow: provider.getContextWindow(), outputReserve: provider.getMaxOutputTokens?.() ?? Math.min(1024, Math.floor(provider.getContextWindow() / 4)) });
    const storedUserMessage = this.storage.addMessage({ chatId, role: "user", content: userMessage, ...(attachments.length ? { attachments } : {}), ...(context ? { context } : {}) });
    if (!provider) {
      yield { type: "run.error", message: `Unknown provider "${providerId}"` };
      return;
    }

    const messages: LlmMessage[] = buildContext({
      systemPrompt: this.systemPrompt,
      activeSkillContent: options.activeSkillContent,
      outputInstructions,
      history,
      currentMessage,
    });

    const startedAt = Date.now();
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
    const records: NewToolCallInput[] = [];
    let toolIterations = 0;
    let hasUsage = false;
    let finalized = false;

    const persistError = (): boolean => {
      finalized = true;
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

    try {
      yield { type: "run.started", provider: provider.id, model: provider.model };
      yield { type: "run.context", context: context! };
      while (true) {
        if (options.signal?.aborted || context!.budget!.overLimit) {
          yield { type: "run.error", message: persistError() ? options.signal?.aborted ? "Генерация остановлена." : "Контекст превышает окно модели. Уменьшите текст/вложения, историю или набор инструментов." : PERSISTENCE_FAILURE_MESSAGE };
          return;
        }
        let assistantText = "";
        const calls: ToolCall[] = [];
        let turnUsage: TokenUsage | undefined;
        let turnFailed: string | undefined;
        let sawDone = false;
        let callsRecordedAsSkipped = false;
        const request = {
          messages,
          ...(context!.tools.length > 0 ? { tools: context!.tools } : {}),
          signal: options.signal,
          maxOutputTokens: context!.budget!.outputReserve,
        };

        try {
          for await (const event of provider.chat(request)) {
            if (options.signal?.aborted) { turnFailed = "Генерация остановлена."; break; }
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
              turnFailed = options.signal?.aborted
                ? "Генерация остановлена."
                : event.code === "timeout"
                  ? "Таймаут запроса к модели. Увеличьте таймаут в настройках модели."
                  : PROVIDER_FAILURE_MESSAGE;
              break;
            }
          }
        } catch {
          turnFailed = options.signal?.aborted ? "Генерация остановлена." : PROVIDER_FAILURE_MESSAGE;
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

        if (!turnFailed && calls.length === 0 && outputInstructions && !assistantText.trim()) {
          turnFailed = "Модель завершила генерацию без содержимого файла. Повторите запрос или выберите другую модель.";
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
            finalized = true;
            this.storage.completeRun({
              chatId,
              messageId: storedUserMessage.id,
              provider: provider.id,
              model: provider.model,
              status: "success",
              tokensIn: hasUsage ? usage.promptTokens : undefined,
              tokensOut: hasUsage ? usage.completionTokens : undefined,
              durationMs: Date.now() - startedAt,
            }, records, { chatId, role: "assistant", content: assistantText, provider: provider.id, model: provider.model, ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}) });
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
          try {
            if (!offeredToolNames.has(call.name)) throw new Error(TOOL_FAILURE_MESSAGE);
            yield { type: "tool.started", tool: call.name, arguments: call.arguments };
            options.signal?.throwIfAborted();
            const result = options.signal ? await this.toolRuntime.execute(call.name, call.arguments, options.signal) : await this.toolRuntime.execute(call.name, call.arguments);
            options.signal?.throwIfAborted();
            const serializedResult = JSON.stringify(result);
            if (serializedResult === undefined) throw new Error(TOOL_FAILURE_MESSAGE);
            if (serializedResult.length > 1_000_000) throw new Error(TOOL_FAILURE_MESSAGE);
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
        const added = messages.slice(history.length + 2).reduce((sum, message) => sum + estimateTokens(JSON.stringify(message)), 0);
        const budget = context!.budget!;
        budget.breakdown.results = added;
        budget.usedTokens = Object.values(budget.breakdown).reduce((sum, count) => sum + count, 0);
        budget.availableTokens = Math.max(0, budget.contextWindow - budget.outputReserve - budget.usedTokens);
        budget.overLimit = budget.usedTokens + budget.outputReserve > budget.contextWindow;
        yield { type: "run.context", context: context! };
        if (failed) {
          yield { type: "run.error", message: persistError() ? TOOL_FAILURE_MESSAGE : PERSISTENCE_FAILURE_MESSAGE };
          return;
        }
        toolIterations++;
      }
    } finally { if (!finalized) persistError(); }
  }

  previewTurn(chatId: string, userMessage: string, options: RunTurnOptions = {}): { providerId: string; model: string; context: RequestContext } {
    const currentMessage = messageText(userMessage, validateAttachments(options.attachments));
    const systemPrompt = [this.systemPrompt, responseInstructions(options.responseFormat)].filter(Boolean).join("\n\n");
    const allowed = options.allowedToolNames === undefined ? undefined : new Set(options.allowedToolNames);
    const tools = (this.toolRuntime?.listTools() ?? []).filter(({ name }) => !allowed || allowed.has(name));
    const id = this.resolveProviderId(options, tools.length > 0);
    const provider = id ? this.registry.get(id) : this.registry.getDefault();
    if (!provider) throw new RangeError("Модель недоступна");
    const history = this.turnHistory(chatId, options.historyLimit);
    const offered = provider.supportsTools() ? tools : [];
    return { providerId: provider.id, model: provider.model, context: {
      systemPrompt, ...(options.activeSkillContent ? { skill: { id: options.activeSkillId ?? "", content: options.activeSkillContent } } : {}), tools: offered,
      budget: estimateContext({ systemPrompt, activeSkillContent: options.activeSkillContent, tools: offered, history, currentMessage, contextWindow: provider.getContextWindow(), outputReserve: provider.getMaxOutputTokens?.() ?? Math.min(1024, Math.floor(provider.getContextWindow() / 4)) }),
    } };
  }

  async compact(chatId: string, options: RunTurnOptions = {}): Promise<CompactResult> {
    if (!this.contextStorage) throw new Error("Сжатие контекста недоступно");
    const saved = this.storage.listMessages(chatId).filter(item => !item.error);
    const through = saved.at(-1);
    if (!through) throw new Error("В чате пока нет сообщений для сжатия");
    const history = this.turnHistory(chatId);
    const providerId = this.resolveProviderId(options, false);
    const provider = providerId ? this.registry.get(providerId) : this.registry.getDefault();
    if (!provider) throw new Error("Модель недоступна");
    const { summary, usage } = await summarizeConversation(provider, history, options.signal);
    options.signal?.throwIfAborted();
    this.contextStorage.saveContextCheckpoint(chatId, { throughMessageId: through.id, summary });
    return { summary, provider: provider.id, model: provider.model, compactedMessages: saved.length, beforeTokens: history.reduce((sum, item) => sum + estimateTokens(item.content), 0), afterTokens: estimateTokens(`Conversation summary (reference data):\n${summary}`), ...(usage ? { usage } : {}) };
  }

  private turnHistory(chatId: string, limit?: number): StoredMessage[] {
    if (limit === 0) return [];
    let messages = this.storage.listMessages(chatId).filter(item => !item.error);
    const checkpoint = this.contextStorage?.getContextCheckpoint(chatId);
    const index = checkpoint ? messages.findIndex(item => item.id === checkpoint.throughMessageId) : -1;
    if (index >= 0) messages = messages.slice(index + 1);
    if (limit !== undefined) messages = messages.slice(-limit);
    if (checkpoint && index >= 0) messages.unshift({ id: `summary-${checkpoint.throughMessageId}`, chatId, role: "assistant", content: `Conversation summary (reference data):\n${checkpoint.summary}`, provider: null, model: null, createdAt: "" });
    return messages.map(({ attachments, ...message }) => ({ ...message, content: messageText(message.content, attachments) }));
  }

  private resolveProviderId(options: RunTurnOptions, toolsAvailable: boolean): string | undefined {
    if (options.providerId) return options.providerId;
    if (options.mode === "auto") {
      return this.router.resolveProviderId({ ...options.routingContext, toolsRequired: toolsAvailable });
    }
    return undefined;
  }
}
