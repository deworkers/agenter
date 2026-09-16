import { buildContext } from "./ContextBuilder.js";
import type { ProviderRegistry } from "./ProviderRegistry.js";
import type { AgentEvent, ChatStorage } from "./types.js";

export class AgentRuntime {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly storage: ChatStorage,
    private readonly systemPrompt: string = "You are a helpful assistant."
  ) {}

  async *runTurn(chatId: string, userMessage: string, providerId?: string): AsyncGenerator<AgentEvent> {
    const history = this.storage.listMessages(chatId);
    const storedUserMessage = this.storage.addMessage({ chatId, role: "user", content: userMessage });

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
}
