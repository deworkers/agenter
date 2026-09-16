import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./AgentRuntime.js";
import { ProviderRegistry } from "./ProviderRegistry.js";
import type { ChatStorage, LlmEvent, LlmProvider, StoredMessage } from "./types.js";

function fakeStorage(initialHistory: StoredMessage[] = []): ChatStorage {
  const history = [...initialHistory];
  return {
    createChat: vi.fn(),
    listChats: vi.fn(() => []),
    getChat: vi.fn(),
    deleteChat: vi.fn(),
    touchChat: vi.fn(),
    listMessages: vi.fn(() => history),
    addMessage: vi.fn((input) => {
      const stored: StoredMessage = {
        id: `m${history.length + 1}`,
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        provider: input.provider ?? null,
        model: input.model ?? null,
        createdAt: new Date().toISOString(),
      };
      history.push(stored);
      return stored;
    }),
    addRun: vi.fn((input) => ({
      id: "r1",
      chatId: input.chatId,
      messageId: input.messageId,
      provider: input.provider,
      model: input.model,
      status: input.status,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      durationMs: input.durationMs,
      createdAt: new Date().toISOString(),
    })),
  };
}

function fakeProvider(id: string, model: string, events: LlmEvent[]): LlmProvider {
  return {
    id,
    model,
    supportsTools: () => false,
    supportsVision: () => false,
    getContextWindow: () => 8192,
    async *chat(): AsyncIterable<LlmEvent> {
      for (const event of events) {
        yield event;
      }
    },
  };
}

function registryWith(providers: LlmProvider[], defaultProviderId: string): ProviderRegistry {
  const registry = new ProviderRegistry(defaultProviderId);
  for (const provider of providers) registry.register(provider);
  return registry;
}

describe("AgentRuntime.runTurn", () => {
  it("uses the registry's default provider when none is named", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "done", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);
    const registry = registryWith([provider], "fake");
    const runtime = new AgentRuntime(registry, storage, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.started", provider: "fake", model: "fake-model" },
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "run.completed", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);

    expect(storage.addMessage).toHaveBeenNthCalledWith(1, {
      chatId: "chat-1",
      role: "user",
      content: "hi",
    });
    expect(storage.addMessage).toHaveBeenNthCalledWith(2, {
      chatId: "chat-1",
      role: "assistant",
      content: "Hello!",
      provider: "fake",
      model: "fake-model",
    });
    expect(storage.addRun).toHaveBeenCalledOnce();
  });

  it("uses the named provider when providerId is given", async () => {
    const storage = fakeStorage();
    const defaultProvider = fakeProvider("default-one", "default-model", []);
    const namedProvider = fakeProvider("other", "other-model", [
      { type: "text.delta", text: "Hi" },
      { type: "done" },
    ]);
    const registry = registryWith([defaultProvider, namedProvider], "default-one");
    const runtime = new AgentRuntime(registry, storage, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", "other")) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "run.started", provider: "other", model: "other-model" });
  });

  it("emits run.error and persists no assistant message when providerId is unknown", async () => {
    const storage = fakeStorage();
    const registry = registryWith([fakeProvider("fake", "fake-model", [])], "fake");
    const runtime = new AgentRuntime(registry, storage, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", "unknown-provider")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.error", message: 'Unknown provider "unknown-provider"' },
    ]);
    expect(storage.addMessage).toHaveBeenCalledOnce();
    expect(storage.addMessage).toHaveBeenCalledWith({
      chatId: "chat-1",
      role: "user",
      content: "hi",
    });
    expect(storage.addRun).not.toHaveBeenCalled();
  });

  it("emits run.error and does not persist an assistant message when the provider errors", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [{ type: "error", message: "upstream down" }]);
    const registry = registryWith([provider], "fake");
    const runtime = new AgentRuntime(registry, storage, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.started", provider: "fake", model: "fake-model" },
      { type: "run.error", message: "upstream down" },
    ]);

    expect(storage.addMessage).toHaveBeenCalledOnce();
    expect(storage.addMessage).toHaveBeenCalledWith({
      chatId: "chat-1",
      role: "user",
      content: "hi",
    });
  });
});
