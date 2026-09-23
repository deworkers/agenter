import { buildContext } from "./ContextBuilder.js";
import type { ProviderRegistry } from "./ProviderRegistry.js";
import type { ProviderRouter, RoutingContext } from "./ProviderRouter.js";
import type { AgentEvent, ChatStorage } from "./types.js";

export interface RunTurnOptions {
  providerId?: string;
  mode?: "manual" | "auto";
  routingContext?: RoutingContext;
}

export class AgentRuntime {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly storage: ChatStorage,
    private readonly router: ProviderRouter,
    private readonly systemPrompt: string = "You are a helpful assistant."
  ) {}

  async *runTurn(chatId: string, userMessage: string, options: RunTurnOptions = {}): AsyncGenerator<AgentEvent> {
    const history = this.storage.listMessages(chatId);
    const storedUserMessage = this.storage.addMessage({ chatId, role: "user", content: userMessage });

    const providerId = this.resolveProviderId(options);
    const provider = providerId ? this.registry.get(providerId) : this.registry.getDefault();
    if (!provider) {
      yield { type: "run.error", message: `Unknown provider "${providerId}"` };
      return;
    }

    const context = buildContext({
      systemPrompt: this.systemPrompt,
      history,
      currentMessage: userMessage,
    });

    yield { type: "run.started", provider: provider.id, model: provider.model };

    const startedAt = Date.now();
    let assistantText = "";

    for await (const event of provider.chat({ messages: context })) {
      if (event.type === "text.delta") {
        assistantText += event.text;
        yield { type: "text.delta", text: event.text };
        continue;
      }

      if (event.type === "error") {
        this.storage.addRun({
          chatId,
          messageId: storedUserMessage.id,
          provider: provider.id,
          model: provider.model,
          status: "error",
          durationMs: Date.now() - startedAt,
        });
        yield { type: "run.error", message: event.message };
        return;
      }

      this.storage.addMessage({
        chatId,
        role: "assistant",
        content: assistantText,
        provider: provider.id,
        model: provider.model,
      });

      this.storage.addRun({
        chatId,
        messageId: storedUserMessage.id,
        provider: provider.id,
        model: provider.model,
        status: "success",
        tokensIn: event.usage?.promptTokens,
        tokensOut: event.usage?.completionTokens,
        durationMs: Date.now() - startedAt,
      });

      this.storage.touchChat(chatId);

      yield { type: "run.completed", usage: event.usage };
    }
  }

  private resolveProviderId(options: RunTurnOptions): string | undefined {
    if (options.providerId) return options.providerId;
    if (options.mode === "auto") return this.router.resolveProviderId(options.routingContext ?? {});
    return undefined;
  }
}
