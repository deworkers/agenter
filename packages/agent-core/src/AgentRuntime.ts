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
  LlmProvider,
  NewToolCallInput,
  RequestContext,
  TokenUsage,
  RunErrorCode,
  ToolCall,
  ContextCheckpointStorage,
  CompactResult,
  StoredMessage,
  TextAttachment,
  ResponseFormat,
} from "./types.js";

export const MAX_TOOL_ITERATIONS = 10;
export const MAX_SELF_CHECK_CONTINUATIONS = 2;

export interface AgentRuntimeOptions {
  systemPrompt?: string;
  toolRuntime?: AgentToolRuntime;
  maxToolIterations?: number;
  maxSelfCheckContinuations?: number;
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
const SELF_CHECK_INSTRUCTION = "Review the original user request, the available conversation, tool results, and the proposed assistant answer. Decide whether the requested task has actually been completed. For this verification request, return only one JSON object with status: done, continue, or blocked, regardless of any requested final answer format. Use done only when the answer completes the request; continue when further work with available tools or reasoning can advance it; blocked when user input or unavailable access is required. Include a short reason for continue or blocked. Do not call tools or answer the user.";
const CONTINUE_INSTRUCTION = "The proposed answer did not complete the original request. Continue working from the available context and tool results. Call an available tool if it would help. Give a final answer only when the task is complete; state any genuine blocker clearly.";
const SELF_CHECK_OUTPUT_TOKENS = 256;
const SELF_CHECK_MAX_CHARS = 4000;

type CompletionVerdict = { status: "done" | "continue" | "blocked"; reason?: string };

async function checkCompletion(provider: LlmProvider, messages: LlmMessage[], candidate: string, signal?: AbortSignal): Promise<{ verdict?: CompletionVerdict; usage?: TokenUsage }> {
  const checkMessages: LlmMessage[] = [
    { role: "system", content: `${messages[0]?.content ?? ""}\n\n${SELF_CHECK_INSTRUCTION}` },
    ...messages.slice(1),
    { role: "assistant", content: candidate },
    { role: "user", content: "Evaluate the proposed answer against the original request. Return the JSON verdict." },
  ];
  const reserve = Math.min(SELF_CHECK_OUTPUT_TOKENS, provider.getMaxOutputTokens?.() ?? SELF_CHECK_OUTPUT_TOKENS);
  if (checkMessages.reduce((sum, message) => sum + estimateTokens(JSON.stringify(message)), 0) + reserve > provider.getContextWindow()) return {};
  let text = "";
  let completed = false;
  let usage: TokenUsage | undefined;
  try {
    for await (const event of provider.chat({ messages: checkMessages, signal, maxOutputTokens: reserve })) {
      signal?.throwIfAborted();
      if (event.type === "text.delta") {
        text += event.text;
        if (text.length > SELF_CHECK_MAX_CHARS) return {};
      } else if (event.type === "done") {
        completed = true;
        usage = event.usage;
        break;
      } else return {};
    }
  } catch {
    return {};
  }
  if (!completed) return { usage };
  try {
    const raw = text.trim();
    const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(raw);
    const value: unknown = JSON.parse(fenced?.[1] ?? raw);
    if (!isJsonObject(value) || !["done", "continue", "blocked"].includes(String(value.status))) return { usage };
    if (value.reason !== undefined && typeof value.reason !== "string") return { usage };
    const verdict: CompletionVerdict = { status: value.status as CompletionVerdict["status"] };
    if (typeof value.reason === "string") verdict.reason = value.reason.trim().slice(0, 300);
    return { verdict, usage };
  } catch {
    return { usage };
  }
}

function incompleteAnswer(candidate: string, reason: string): string {
  return `${candidate}${candidate ? "\n\n" : ""}Задача не завершена. ${reason}`;
}

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

function isRecoverableToolUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "unavailable" &&
    "recoverable" in error && error.recoverable === true;
}

export class AgentRuntime {
  private readonly systemPrompt: string;
  private readonly toolRuntime?: AgentToolRuntime;
  private readonly maxToolIterations: number;
  private readonly maxSelfCheckContinuations: number;
  private readonly contextStorage?: ContextCheckpointStorage;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly storage: ChatStorage,
    private readonly router: ProviderRouter,
    options: AgentRuntimeOptions = {}
  ) {
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.toolRuntime = options.toolRuntime;
    this.maxToolIterations = Number.isNaN(options.maxToolIterations) ? MAX_TOOL_ITERATIONS : Math.max(0, Math.min(MAX_TOOL_ITERATIONS, Math.floor(options.maxToolIterations ?? MAX_TOOL_ITERATIONS)));
    this.maxSelfCheckContinuations = Number.isNaN(options.maxSelfCheckContinuations) ? 0 : Math.max(0, Math.min(MAX_SELF_CHECK_CONTINUATIONS, Math.floor(options.maxSelfCheckContinuations ?? 0)));
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
      try {
        this.storage.completeRun({ chatId, messageId: storedUserMessage.id, provider: providerId ?? "unknown", model: "unknown", status: "error", errorCode: "provider_unavailable", durationMs: 0 }, []);
        yield { type: "run.error", code: "provider_unavailable", message: PROVIDER_FAILURE_MESSAGE };
      } catch {
        yield { type: "run.error", code: "persistence_failed", message: PERSISTENCE_FAILURE_MESSAGE };
      }
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
    let selfCheckContinuations = 0;
    const selfCheckEnabled = this.maxSelfCheckContinuations > 0;
    let hasUsage = false;
    let finalized = false;
    let runErrorCode: RunErrorCode | undefined;
    const recoverablyFailedTools = new Set<string>();

    const persistError = (code?: RunErrorCode): boolean => {
      finalized = true;
      runErrorCode = code ?? runErrorCode;
      try {
        this.storage.completeRun({
          chatId,
          messageId: storedUserMessage.id,
          provider: provider.id,
          model: provider.model,
          status: "error",
          ...(runErrorCode ? { errorCode: runErrorCode } : {}),
          tokensIn: hasUsage ? usage.promptTokens : undefined,
          tokensOut: hasUsage ? usage.completionTokens : undefined,
          durationMs: Date.now() - startedAt,
        }, records);
        return true;
      } catch {
        return false;
      }
    };
    const finalizeError = (code: RunErrorCode, message: string): AgentEvent => {
      const persisted = persistError(code);
      return { type: "run.error", code: persisted ? code : "persistence_failed", message: persisted ? message : PERSISTENCE_FAILURE_MESSAGE };
    };

    try {
      yield { type: "run.started", provider: provider.id, model: provider.model };
      yield { type: "run.context", context: context! };
      while (true) {
        if (options.signal?.aborted || context!.budget!.overLimit) {
          const code = options.signal?.aborted ? "cancelled" : "context_over_limit";
          yield finalizeError(code, options.signal?.aborted ? "Генерация остановлена." : "Контекст превышает окно модели. Уменьшите текст/вложения, историю или набор инструментов.");
          return;
        }
        let assistantText = "";
        const calls: ToolCall[] = [];
        let turnUsage: TokenUsage | undefined;
        let turnFailed: string | undefined;
        let turnErrorCode: RunErrorCode | undefined;
        let sawDone = false;
        let callsRecordedAsSkipped = false;
        const request = {
          messages,
          ...(context!.tools.length > 0 ? { tools: context!.tools } : {}),
          signal: options.signal,
          maxOutputTokens: context!.budget!.outputReserve,
        };

        try {
          yield { type: "run.phase", stage: "waiting" };
          for await (const event of provider.chat(request)) {
            if (options.signal?.aborted) { turnFailed = "Генерация остановлена."; turnErrorCode = "cancelled"; break; }
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
              turnErrorCode = options.signal?.aborted ? "cancelled" : event.code === "timeout" ? "timeout" : "provider_unavailable";
              turnFailed = turnErrorCode === "cancelled" ? "Генерация остановлена." : turnErrorCode === "timeout" ? "Таймаут запроса к модели. Увеличьте таймаут в настройках модели." : PROVIDER_FAILURE_MESSAGE;
              break;
            }
          }
        } catch {
          turnErrorCode = options.signal?.aborted ? "cancelled" : "provider_unavailable";
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
          turnErrorCode = "incomplete_response";
        }

        if (!turnFailed && calls.length === 0 && outputInstructions && !assistantText.trim()) {
          turnFailed = "Модель завершила генерацию без содержимого файла. Повторите запрос или выберите другую модель.";
          turnErrorCode = "invalid_response";
        }

        if (turnFailed) {
          if (calls.length > 0 && !callsRecordedAsSkipped) {
            for (const call of calls) {
              records.push({ toolName: call.name || "", arguments: storedArguments(call.arguments), result: null, status: "skipped" });
            }
          }
          const code = turnErrorCode ?? "provider_unavailable";
          yield finalizeError(code, turnFailed);
          return;
        }

        if (calls.length === 0) {
          let finalText = assistantText;
          if (selfCheckEnabled) {
            yield { type: "run.phase", stage: "checking" };
            const check = await checkCompletion(provider, messages, assistantText, options.signal);
            addUsage(usage, check.usage);
            hasUsage ||= check.usage !== undefined;
            if (options.signal?.aborted) {
              const code = options.signal?.aborted ? "cancelled" : "provider_unavailable";
              yield finalizeError(code, options.signal?.aborted ? "Генерация остановлена." : PROVIDER_FAILURE_MESSAGE);
              return;
            }
            if (check.verdict?.status === "continue" && selfCheckContinuations < this.maxSelfCheckContinuations) {
              const draftMessage: LlmMessage = { role: "assistant", content: assistantText };
              const continuationMessage: LlmMessage = { role: "user", content: CONTINUE_INSTRUCTION };
              const added = estimateTokens(JSON.stringify(draftMessage)) + estimateTokens(JSON.stringify(continuationMessage));
              const budget = context!.budget!;
              if (budget.usedTokens + added + budget.outputReserve <= budget.contextWindow) {
                yield { type: "text.reset" };
                messages.push(draftMessage, continuationMessage);
                selfCheckContinuations++;
                budget.breakdown.results += added;
                budget.usedTokens += added;
                budget.availableTokens = Math.max(0, budget.contextWindow - budget.outputReserve - budget.usedTokens);
                yield { type: "run.context", context: context! };
                continue;
              }
              finalText = incompleteAnswer(assistantText, "Для продолжения не хватает контекстного окна модели.");
            }
            if (check.verdict?.status === "blocked") finalText = incompleteAnswer(assistantText, check.verdict.reason || "Для продолжения нужны данные или доступ пользователя.");
            else if (check.verdict?.status === "continue" && finalText === assistantText) finalText = incompleteAnswer(assistantText, "Достигнут предел самостоятельных продолжений.");
            else if (!check.verdict || !assistantText.trim()) finalText = incompleteAnswer(assistantText, "Не удалось подтвердить завершение задачи.");
          }
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
            }, records, { chatId, role: "assistant", content: finalText, provider: provider.id, model: provider.model, ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}) });
          } catch {
            yield { type: "run.error", code: "persistence_failed", message: PERSISTENCE_FAILURE_MESSAGE };
            return;
          }
          if (selfCheckEnabled && finalText !== assistantText) yield { type: "text.delta", text: finalText.slice(assistantText.length) };
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
          runErrorCode = "tool_invalid_result";
          calls.forEach((call, index) => records.push({
            toolName: call.name || "",
            arguments: storedArguments(call.arguments),
            result: null,
            status: index === malformedIndex ? "error" : "skipped",
          }));
          const code = "tool_invalid_result";
          yield finalizeError(code, TOOL_FAILURE_MESSAGE);
          return;
        }
        if (!this.toolRuntime || !provider.supportsTools() || toolDefinitions.length === 0) {
          calls.forEach((call, index) => records.push({
            toolName: call.name || "",
            arguments: storedArguments(call.arguments),
            result: null,
            status: index === 0 ? "error" : "skipped",
          }));
          const code = "tool_not_allowed";
          yield finalizeError(code, "Tool calls are not enabled for this runtime.");
          return;
        }

        if (selfCheckEnabled && assistantText) yield { type: "text.reset" };
        messages.push({ role: "assistant", content: assistantText || null, toolCalls: calls });
        if (toolIterations >= this.maxToolIterations) {
          for (const call of calls) records.push({ toolName: call.name, arguments: storedArguments(call.arguments), result: null, status: "skipped" });
          const code = "tool_failed";
          yield finalizeError(code, TOOL_FAILURE_MESSAGE);
          return;
        }

        let failed = false;
        for (let index = 0; index < calls.length; index++) {
          const call = calls[index]!;
          const argsText = storedArguments(call.arguments);
          try {
            if (!offeredToolNames.has(call.name) || recoverablyFailedTools.has(call.name)) { runErrorCode = recoverablyFailedTools.has(call.name) ? "tool_failed" : "tool_not_allowed"; throw new Error(TOOL_FAILURE_MESSAGE); }
            yield { type: "tool.started", tool: call.name, arguments: call.arguments };
            options.signal?.throwIfAborted();
            const result = options.signal ? await this.toolRuntime.execute(call.name, call.arguments, options.signal) : await this.toolRuntime.execute(call.name, call.arguments);
            options.signal?.throwIfAborted();
            let serializedResult: string | undefined;
            try { serializedResult = JSON.stringify(result); } catch { runErrorCode = "tool_invalid_result"; throw new Error(TOOL_FAILURE_MESSAGE); }
            if (serializedResult === undefined) { runErrorCode = "tool_invalid_result"; throw new Error(TOOL_FAILURE_MESSAGE); }
            if (serializedResult.length > 1_000_000) { runErrorCode = "tool_result_too_large"; throw new Error(TOOL_FAILURE_MESSAGE); }
            try { JSON.parse(serializedResult); } catch { runErrorCode = "tool_invalid_result"; throw new Error(TOOL_FAILURE_MESSAGE); }
            records.push({ toolName: call.name, arguments: argsText, result: serializedResult, status: "success" });
            yield { type: "tool.completed", tool: call.name, result };
            messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: serializedResult });
          } catch (error) {
            if (options.signal?.aborted) runErrorCode = "cancelled";
            else if (isRecoverableToolUnavailable(error)) {
              const safeResult = JSON.stringify({ error: { code: "unavailable", message: "Источник инструмента временно недоступен." } });
              records.push({ toolName: call.name, arguments: argsText, result: safeResult, status: "error" });
              recoverablyFailedTools.add(call.name);
              yield { type: "tool.failed", tool: call.name, code: "tool_unavailable" };
              messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: safeResult });
              continue;
            } else runErrorCode ??= "tool_failed";
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
          const code = runErrorCode ?? "tool_failed";
          const message = code === "cancelled" ? "Генерация остановлена." : TOOL_FAILURE_MESSAGE;
          yield finalizeError(code, message);
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
