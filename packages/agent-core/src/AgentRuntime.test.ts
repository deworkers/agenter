import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./AgentRuntime.js";
import { ProviderRegistry } from "./ProviderRegistry.js";
import { ProviderRouter } from "./ProviderRouter.js";
import type { RoutingConfig } from "./ProviderRouter.js";
import type { ChatStorage, LlmEvent, LlmProvider, StoredMessage } from "./types.js";

function fakeStorage(initialHistory: StoredMessage[] = []): ChatStorage {
  const history = [...initialHistory];
  return {
    createChat: vi.fn(),
    listChats: vi.fn(() => []),
    getChat: vi.fn(),
    deleteChat: vi.fn(),
    touchChat: vi.fn(),
    listMessages: vi.fn(() => [...history]),
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

const routingConfig: RoutingConfig = {
  simple: { provider: "fake" },
  coding: { provider: "coder" },
  reasoning: { provider: "fake" },
  research: { provider: "fake" },
  vision: { provider: "fake" },
};

describe("AgentRuntime.runTurn", () => {
  it("uses the registry's default provider when no options are given", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "done", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

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
    expect(storage.addRun).toHaveBeenCalledOnce();
  });

  it("uses the named provider when providerId is given, ignoring mode", async () => {
    const storage = fakeStorage();
    const defaultProvider = fakeProvider("default-one", "default-model", []);
    const namedProvider = fakeProvider("other", "other-model", [
      { type: "text.delta", text: "Hi" },
      { type: "done" },
    ]);
    const registry = registryWith([defaultProvider, namedProvider], "default-one");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { providerId: "other", mode: "auto" })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "run.started", provider: "other", model: "other-model" });
  });

  it("routes via ProviderRouter when mode is auto and no providerId is given", async () => {
    const storage = fakeStorage();
    const fast = fakeProvider("fake", "fake-model", []);
    const coder = fakeProvider("coder", "coder-model", [
      { type: "text.delta", text: "code" },
      { type: "done" },
    ]);
    const registry = registryWith([fast, coder], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", {
      mode: "auto",
      routingContext: { activeSkill: "code-review" },
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "run.started", provider: "coder", model: "coder-model" });
  });

  it("falls back to the registry default when mode is auto but routingContext is omitted", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [{ type: "done" }]);
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { mode: "auto" })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "run.started", provider: "fake", model: "fake-model" });
  });

  it("uses the registry default when mode is manual (or omitted) and no providerId is given", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [{ type: "done" }]);
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { mode: "manual" })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "run.started", provider: "fake", model: "fake-model" });
  });

  it("emits run.error and persists no assistant message when providerId is unknown", async () => {
    const storage = fakeStorage();
    const registry = registryWith([fakeProvider("fake", "fake-model", [])], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { providerId: "unknown-provider" })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.error", message: 'Unknown provider "unknown-provider"' },
    ]);
    expect(storage.addMessage).toHaveBeenCalledOnce();
    expect(storage.addRun).not.toHaveBeenCalled();
  });

  it("emits run.error and does not persist an assistant message when the provider errors", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [{ type: "error", message: "upstream down" }]);
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.started", provider: "fake", model: "fake-model" },
      { type: "run.error", message: "upstream down" },
    ]);
    expect(storage.addMessage).toHaveBeenCalledOnce();
  });

  it("forwards activeSkillContent into the built context as an extra system message", async () => {
    const storage = fakeStorage();
    let capturedMessages: unknown;
    const provider: LlmProvider = {
      id: "fake",
      model: "fake-model",
      supportsTools: () => false,
      supportsVision: () => false,
      getContextWindow: () => 8192,
      async *chat(request) {
        capturedMessages = request.messages;
        yield { type: "done" };
      },
    };
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, "You are helpful.");

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "review this", {
      activeSkillContent: "# Code Review\n\nInspect correctness.",
    })) {
      events.push(event);
    }

    expect(capturedMessages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "system", content: "# Code Review\n\nInspect correctness." },
      { role: "user", content: "review this" },
    ]);
  });
});
