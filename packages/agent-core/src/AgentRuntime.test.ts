import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./AgentRuntime.js";
import { ProviderRegistry } from "./ProviderRegistry.js";
import { ProviderRouter } from "./ProviderRouter.js";
import type { RoutingConfig } from "./ProviderRouter.js";
import type { AgentToolRuntime, ChatStorage, LlmEvent, LlmProvider, StoredMessage } from "./types.js";

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
    completeRun: vi.fn((input, _toolCalls, assistantMessage) => {
      if (assistantMessage) {
        history.push({
          id: `m${history.length + 1}`,
          chatId: assistantMessage.chatId,
          role: assistantMessage.role,
          content: assistantMessage.content,
          provider: assistantMessage.provider ?? null,
          model: assistantMessage.model ?? null,
          createdAt: new Date().toISOString(),
        });
      }
      return {
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
      };
    }),
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

describe("conversation compaction", () => {
  const message = (id: string, role: "user" | "assistant", content: string): StoredMessage => ({ id, role, content, chatId: "c", provider: null, model: null, createdAt: "" });
  it("saves a summary checkpoint and uses it with new messages while preserving full history", async () => {
    const storage = fakeStorage([message("m1", "user", "Old question"), message("m2", "assistant", "Old answer")]);
    let checkpoint: { throughMessageId: string; summary: string } | undefined;
    const contextStorage = { getContextCheckpoint: () => checkpoint, saveContextCheckpoint: vi.fn((_chatId: string, next: { throughMessageId: string; summary: string }) => { checkpoint = next; }) };
    const requests: import("./types.js").LlmRequest[] = [];
    const provider = { ...fakeProvider("fake", "test", []), async *chat(request: import("./types.js").LlmRequest): AsyncIterable<LlmEvent> { requests.push(structuredClone({ ...request, signal: undefined })); yield { type: "text.delta", text: requests.length === 1 ? "User asked Old question; answer was Old answer." : "Next answer" }; yield { type: "done" }; } };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig), { contextStorage });
    const compacted = await runtime.compact("c");
    expect(compacted.compactedMessages).toBe(2);
    expect(checkpoint?.throughMessageId).toBe("m2");
    expect(storage.listMessages("c")).toHaveLength(2);
    for await (const event of runtime.runTurn("c", "Next question")) void event;
    expect(requests[1]?.messages.map(item => item.content).join("\n")).toContain(checkpoint?.summary);
    expect(requests[1]?.messages.filter(item => item.content === "Old question")).toEqual([]);
    expect(requests[1]?.messages.at(-1)?.content).toBe("Next question");
    expect(storage.listMessages("c")).toHaveLength(4);
  });
  it("leaves an existing checkpoint intact if summary generation fails or is aborted", async () => {
    const storage = fakeStorage([message("m1", "user", "Question")]);
    const contextStorage = { getContextCheckpoint: () => ({ throughMessageId: "m1", summary: "Previous summary" }), saveContextCheckpoint: vi.fn() };
    const runtime = new AgentRuntime(registryWith([fakeProvider("fake", "test", [{ type: "text.delta", text: "Partial" }])], "fake"), storage, new ProviderRouter(routingConfig), { contextStorage });
    await expect(runtime.compact("c")).rejects.toThrow();
    const abort = new AbortController(); abort.abort();
    await expect(runtime.compact("c", { signal: abort.signal })).rejects.toThrow();
    expect(contextStorage.saveContextCheckpoint).not.toHaveBeenCalled();
    expect(storage.listMessages("c")).toHaveLength(1);
  });
  it("summarizes an overflowing transcript in bounded requests without offering tools", async () => {
    const storage = fakeStorage([message("m1", "user", "long text ".repeat(200))]);
    const requests: import("./types.js").LlmRequest[] = [];
    const provider = { ...fakeProvider("fake", "test", []), getContextWindow: () => 256, getMaxOutputTokens: () => 64, async *chat(request: import("./types.js").LlmRequest): AsyncIterable<LlmEvent> { requests.push(request); yield { type: "text.delta", text: "Facts retained." }; yield { type: "done" }; } };
    const contextStorage = { getContextCheckpoint: () => undefined, saveContextCheckpoint: vi.fn() };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig), { contextStorage });
    await runtime.compact("c");
    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) {
      expect(request.tools).toBeUndefined();
      const { estimateTokens } = await import("./ContextBudget.js");
      expect(request.messages.reduce((sum, item) => sum + estimateTokens(item.content ?? ""), 0) + request.maxOutputTokens!).toBeLessThanOrEqual(256);
    }
    expect(contextStorage.saveContextCheckpoint).toHaveBeenCalledOnce();
  });
});

describe("AgentRuntime.runTurn", () => {
  it("records an interrupted run when the consumer disconnects after run.started", async () => {
    const storage = fakeStorage();
    const runtime = new AgentRuntime(registryWith([fakeProvider("fake", "test", [])], "fake"), storage, new ProviderRouter(routingConfig));
    const turn = runtime.runTurn("c", "hi");
    expect((await turn.next()).value).toMatchObject({ type: "run.started" });
    await turn.return(undefined);
    expect(storage.completeRun).toHaveBeenCalledOnce();
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), []);
  });
  it("rejects an overflowing context before calling the provider and handles cancellation", async () => {
    let calls = 0;
    const provider = { ...fakeProvider("fake", "fake", []), getContextWindow: () => 128,
      async *chat(request: import("./types.js").LlmRequest): AsyncIterable<LlmEvent> { calls++; request.signal?.throwIfAborted(); yield { type: "done" }; } };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), fakeStorage(), new ProviderRouter(routingConfig));
    const events = [];
    for await (const event of runtime.runTurn("c", "x".repeat(2000))) events.push(event);
    expect(calls).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: "run.error" });
    const abort = new AbortController(); abort.abort();
    for await (const event of runtime.runTurn("c", "hi", { signal: abort.signal })) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "run.error" });
    expect(calls).toBe(0);
  });
  it("advertises only allowed tools and never executes a tool outside that set", async () => {
    const storage = fakeStorage();
    const requests: string[][] = [];
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", []),
      supportsTools: () => true,
      async *chat(request) {
        requests.push(request.tools?.map(({ name }) => name) ?? []);
        yield { type: "tool.call", call: { id: "c1", name: "blocked", arguments: {} } };
        yield { type: "done" };
      },
    };
    const toolRuntime: AgentToolRuntime = {
      listTools: () => ["allowed", "blocked"].map((name) => ({ name, description: name, inputSchema: {} })),
      execute: vi.fn(async () => "should not run"),
    };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig), { toolRuntime });
    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { allowedToolNames: ["allowed"] })) events.push(event);

    expect(requests).toEqual([["allowed"]]);
    expect(events.find((event) => event.type === "run.context")).toMatchObject({ context: { tools: [{ name: "allowed" }] } });
    expect(events.at(-1)?.type).toBe("run.error");
    expect(toolRuntime.execute).not.toHaveBeenCalled();
  });

  it("stores and streams the exact skill and advertised tools for the user turn", async () => {
    const storage = fakeStorage();
    const tool = { name: "lookup", description: "Search", inputSchema: { type: "object" } };
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", [{ type: "done" }]),
      supportsTools: () => true,
    };
    const runtime = new AgentRuntime(
      registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig),
      { systemPrompt: "Base instruction", toolRuntime: { listTools: () => [tool], execute: vi.fn() } }
    );

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { activeSkillId: "review", activeSkillContent: "Review carefully" })) events.push(event);

    const context = { systemPrompt: "Base instruction", skill: { id: "review", content: "Review carefully" }, tools: [tool] };
    expect(storage.addMessage).toHaveBeenCalledWith(expect.objectContaining({ role: "user", context: expect.objectContaining(context) }));
    expect(events[1]).toMatchObject({ type: "run.context", context });
    expect(events[1]).toMatchObject({ context: { budget: { contextWindow: 8192, estimated: true } } });
  });

  it("uses the registry's default provider when no options are given", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "done", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, { systemPrompt: "You are helpful." });

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) {
      events.push(event);
    }

    expect(events.filter((event) => event.type !== "run.context")).toEqual([
      { type: "run.started", provider: "fake", model: "fake-model" },
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "run.completed", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);
    expect(storage.completeRun).toHaveBeenCalledOnce();
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
    const runtime = new AgentRuntime(registry, storage, router, { systemPrompt: "You are helpful." });

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
    const runtime = new AgentRuntime(registry, storage, router, { systemPrompt: "You are helpful." });

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
    const runtime = new AgentRuntime(registry, storage, router, { systemPrompt: "You are helpful." });

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
    const runtime = new AgentRuntime(registry, storage, router, { systemPrompt: "You are helpful." });

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
    const runtime = new AgentRuntime(registry, storage, router, { systemPrompt: "You are helpful." });

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
    const provider = fakeProvider("fake", "fake-model", [{ type: "error", message: "upstream down: sentinel-secret" }]);
    const registry = registryWith([provider], "fake");
    const router = new ProviderRouter(routingConfig);
    const runtime = new AgentRuntime(registry, storage, router, { systemPrompt: "You are helpful." });

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) {
      events.push(event);
    }

    expect(events.filter((event) => event.type !== "run.context")).toEqual([
      { type: "run.started", provider: "fake", model: "fake-model" },
      { type: "run.error", message: "Provider request failed." },
    ]);
    expect(storage.addMessage).toHaveBeenCalledOnce();
    expect(storage.completeRun).toHaveBeenCalledOnce();
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), []);
    expect(JSON.stringify(events)).not.toContain("sentinel-secret");
  });

  it("sanitizes a provider iterator exception and persists one error run", async () => {
    const storage = fakeStorage();
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", []),
      async *chat() {
        await Promise.reject(new Error("request failed with sentinel-secret"));
        yield { type: "done" };
      },
    };
    const runtime = new AgentRuntime(
      registryWith([provider], "fake"),
      storage,
      new ProviderRouter(routingConfig)
    );

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) events.push(event);

    expect(events.filter((event) => event.type !== "run.context")).toEqual([
      { type: "run.started", provider: "fake", model: "fake-model" },
      { type: "run.error", message: "Provider request failed." },
    ]);
    expect(storage.completeRun).toHaveBeenCalledOnce();
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), []);
    expect(JSON.stringify(events)).not.toContain("sentinel-secret");
  });

  it("fails closed on a tool call when no tool runtime is configured", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider("fake", "fake-model", [
      { type: "tool.call", call: { id: "call-1", name: "lookup", arguments: { query: "private" } } },
      { type: "tool.call", call: { id: "call-2", name: "later", arguments: {} } },
      { type: "done" },
    ]);
    const runtime = new AgentRuntime(
      registryWith([provider], "fake"),
      storage,
      new ProviderRouter(routingConfig),
      { systemPrompt: "You are helpful." }
    );

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) events.push(event);

    expect(events.filter((event) => event.type !== "run.context")).toEqual([
      { type: "run.started", provider: "fake", model: "fake-model" },
      { type: "run.error", message: "Tool calls are not enabled for this runtime." },
    ]);
    expect(storage.completeRun).toHaveBeenCalledOnce();
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), [
      { toolName: "lookup", arguments: '{"query":"private"}', result: null, status: "error" },
      { toolName: "later", arguments: "{}", result: null, status: "skipped" },
    ]);
    expect(storage.addMessage).toHaveBeenCalledOnce();
    expect(storage.addMessage).toHaveBeenCalledWith(expect.objectContaining({ role: "user" }));
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("does not advertise or execute tools with a provider that lacks tool support", async () => {
    const storage = fakeStorage();
    let requestTools: unknown;
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", []),
      async *chat(request) {
        requestTools = request.tools;
        yield { type: "tool.call", call: { id: "c1", name: "lookup", arguments: {} } };
        yield { type: "done" };
      },
    };
    const toolRuntime: AgentToolRuntime = {
      listTools: () => [{ name: "lookup", description: "", inputSchema: {} }],
      execute: vi.fn(async () => "unexpected"),
    };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig), { toolRuntime });
    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { mode: "manual" })) events.push(event);
    expect(requestTools).toBeUndefined();
    expect(events[1]).toMatchObject({ type: "run.context", context: { tools: [] } });
    expect(toolRuntime.execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "run.error", message: "Tool calls are not enabled for this runtime." });
  });

  it("forwards activeSkillContent inside a single leading system message", async () => {
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
    const runtime = new AgentRuntime(registry, storage, router, { systemPrompt: "You are helpful." });

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "review this", {
      activeSkillContent: "# Code Review\n\nInspect correctness.",
    })) {
      events.push(event);
    }

    expect(capturedMessages).toEqual([
      { role: "system", content: "You are helpful.\n\n# Code Review\n\nInspect correctness." },
      { role: "user", content: "review this" },
    ]);
  });

  it("executes a tool then returns final text, correlated context and atomic aggregated run", async () => {
    const storage = fakeStorage();
    const requests: Array<{ messages: unknown[]; tools?: unknown[] }> = [];
    let turn = 0;
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", []),
      supportsTools: () => true,
      async *chat(request) {
        requests.push(request);
        if (turn++ === 0) {
          yield { type: "tool.call", call: { id: "c1", name: "lookup", arguments: { q: "x" } } };
          yield { type: "done", usage: { promptTokens: 4, completionTokens: 2 } };
        } else {
          yield { type: "text.delta", text: "answer" };
          yield { type: "done", usage: { promptTokens: 6, completionTokens: 3 } };
        }
      },
    };
    const toolRuntime: AgentToolRuntime = {
      listTools: () => [{ name: "lookup", description: "lookup", inputSchema: { type: "object" } }],
      execute: vi.fn(async () => ({ answer: 42 })),
    };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig), { toolRuntime });
    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) events.push(event);

    expect(events.map(({ type }) => type)).toEqual(["run.started", "run.context", "tool.started", "tool.completed", "run.context", "text.delta", "run.completed"]);
    expect(requests[0]?.tools).toEqual(toolRuntime.listTools());
    expect(requests[1]?.messages.slice(-2)).toEqual([
      { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "lookup", arguments: { q: "x" } }] },
      { role: "tool", toolCallId: "c1", name: "lookup", content: '{"answer":42}' },
    ]);
    expect(storage.completeRun).toHaveBeenCalledOnce();
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "success", tokensIn: 10, tokensOut: 5 }), [
      { toolName: "lookup", arguments: '{"q":"x"}', result: '{"answer":42}', status: "success" },
    ], expect.objectContaining({ role: "assistant", content: "answer" }));
    expect(storage.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
      [{ toolName: "lookup", arguments: '{"q":"x"}', result: '{"answer":42}', status: "success" }],
      expect.objectContaining({ role: "assistant", content: "answer", chatId: "chat-1", provider: "fake", model: "fake-model" })
    );
    expect(storage.addMessage).not.toHaveBeenCalledWith(expect.objectContaining({ role: "assistant" }));
    expect(storage.touchChat).not.toHaveBeenCalled();
  });

  it.each([
    { label: "after text", events: [{ type: "text.delta", text: "partial" }], calls: [] },
    { label: "after tool call", events: [{ type: "tool.call", call: { id: "c1", name: "lookup", arguments: {} } }], calls: [
      { toolName: "lookup", arguments: "{}", result: null, status: "skipped" },
    ] },
  ] as const)("fails and does not persist assistant when provider ends $label without done", async ({ events: providerEvents, calls }) => {
    const storage = fakeStorage();
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", []), supportsTools: () => true,
      async *chat() { for (const event of providerEvents) yield event; },
    };
    const toolRuntime: AgentToolRuntime = {
      listTools: () => [{ name: "lookup", description: "", inputSchema: {} }],
      execute: vi.fn(async () => "should not run"),
    };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig), { toolRuntime });
    const emitted = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) emitted.push(event);
    expect(emitted.at(-1)).toEqual({ type: "run.error", message: "Provider response ended before completion." });
    expect(storage.completeRun).toHaveBeenCalledOnce();
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), calls);
    expect(storage.addMessage).not.toHaveBeenCalledWith(expect.objectContaining({ role: "assistant" }));
    expect(toolRuntime.execute).not.toHaveBeenCalled();
  });

  it("does not persist an assistant or retry terminal persistence when completeRun rejects", async () => {
    const storage = fakeStorage();
    vi.spyOn(storage, "completeRun").mockImplementationOnce(() => { throw new Error("private storage details"); });
    const provider = fakeProvider("fake", "fake-model", [
      { type: "text.delta", text: "answer" }, { type: "done" },
    ]);
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig));
    const emitted = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) emitted.push(event);
    expect(emitted.at(-1)).toEqual({ type: "run.error", message: "Run persistence failed." });
    expect(JSON.stringify(emitted)).not.toContain("private storage details");
    expect(storage.completeRun).toHaveBeenCalledOnce();
    expect(storage.addMessage).not.toHaveBeenCalledWith(expect.objectContaining({ role: "assistant" }));
    expect(storage.touchChat).not.toHaveBeenCalled();
  });

  it("marks only the malformed call error and skips other calls without execution", async () => {
    const storage = fakeStorage();
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", [
        { type: "tool.call", call: { id: "valid", name: "lookup", arguments: {} } },
        { type: "tool.call", call: { id: "invalid", name: "lookup", arguments: null } },
        { type: "done" },
      ]), supportsTools: () => true,
    };
    const toolRuntime: AgentToolRuntime = {
      listTools: () => [{ name: "lookup", description: "", inputSchema: {} }],
      execute: vi.fn(async () => "must not execute"),
    };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig), { toolRuntime });
    for await (const event of runtime.runTurn("chat-1", "hi")) { void event; }
    expect(toolRuntime.execute).not.toHaveBeenCalled();
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), [
      { toolName: "lookup", arguments: "{}", result: null, status: "skipped" },
      { toolName: "lookup", arguments: "null", result: null, status: "error" },
    ]);
  });

  it("stops after a failing call and persists later calls as skipped", async () => {
    const storage = fakeStorage();
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", [
      { type: "tool.call", call: { id: "a", name: "bad", arguments: {} } },
      { type: "tool.call", call: { id: "b", name: "later", arguments: {} } }, { type: "done" },
      ]), supportsTools: () => true,
    };
    const toolRuntime: AgentToolRuntime = {
      listTools: () => [{ name: "bad", description: "", inputSchema: {} }, { name: "later", description: "", inputSchema: {} }],
      execute: vi.fn(async () => { throw new Error("private result"); }),
    };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig), { toolRuntime });
    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) events.push(event);
    expect(toolRuntime.execute).toHaveBeenCalledOnce();
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), [
      { toolName: "bad", arguments: "{}", result: null, status: "error" },
      { toolName: "later", arguments: "{}", result: null, status: "skipped" },
    ]);
    expect(JSON.stringify(events)).not.toContain("private result");
  });

  it.each([
    { label: "unknown", toolName: "missing", failure: 'Tool "missing" is not registered.' },
    { label: "unsafe", toolName: "approval_tool", failure: 'Tool "approval_tool" is not safe to execute.' },
  ])("fails safely when the requested tool is $label", async ({ toolName, failure }) => {
    const storage = fakeStorage();
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", [
        { type: "tool.call", call: { id: "call-1", name: toolName, arguments: {} } },
        { type: "done" },
      ]),
      supportsTools: () => true,
    };
    const toolRuntime: AgentToolRuntime = {
      listTools: () => [{ name: "safe_tool", description: "", inputSchema: {} }],
      execute: vi.fn(async () => { throw new Error(failure); }),
    };
    const runtime = new AgentRuntime(
      registryWith([provider], "fake"),
      storage,
      new ProviderRouter(routingConfig),
      { toolRuntime }
    );

    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) events.push(event);

    expect(events.at(-1)).toEqual({ type: "run.error", message: "Tool execution failed." });
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), [
      { toolName, arguments: "{}", result: null, status: "error" },
    ]);
    expect(JSON.stringify(events)).not.toContain(failure);
  });

  it("runs multiple calls serially and correlates each result to its call id", async () => {
    const storage = fakeStorage();
    const order: string[] = [];
    let turn = 0;
    const requests: Array<{ messages: unknown[] }> = [];
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", []), supportsTools: () => true,
      async *chat(request) {
        requests.push(request);
        if (turn++ === 0) {
          yield { type: "tool.call", call: { id: "first-id", name: "first", arguments: { n: 1 } } };
          yield { type: "tool.call", call: { id: "second-id", name: "second", arguments: { n: 2 } } };
        } else yield { type: "done" };
        yield { type: "done" };
      },
    };
    const toolRuntime: AgentToolRuntime = {
      listTools: () => ["first", "second"].map((name) => ({ name, description: "", inputSchema: {} })),
      execute: vi.fn(async (name) => { order.push(name); return { name }; }),
    };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig), { toolRuntime });
    for await (const event of runtime.runTurn("chat-1", "hi")) { void event; }
    expect(order).toEqual(["first", "second"]);
    expect(requests[1]?.messages.slice(-2)).toEqual([
      { role: "tool", toolCallId: "first-id", name: "first", content: '{"name":"first"}' },
      { role: "tool", toolCallId: "second-id", name: "second", content: '{"name":"second"}' },
    ]);
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }), [
      { toolName: "first", arguments: '{"n":1}', result: '{"name":"first"}', status: "success" },
      { toolName: "second", arguments: '{"n":2}', result: '{"name":"second"}', status: "success" },
    ], expect.objectContaining({ role: "assistant", content: "" }));
  });

  it("rejects invalid calls and non-serializable tool results", async () => {
    const storage = fakeStorage();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const toolRuntime: AgentToolRuntime = { listTools: () => [{ name: "bad", description: "", inputSchema: {} }], execute: vi.fn(async () => cyclic) };
    const provider = fakeProvider("fake", "fake-model", [
      { type: "tool.call", call: { id: "", name: "bad", arguments: null } }, { type: "done" },
    ]);
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, new ProviderRouter(routingConfig), { toolRuntime });
    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi")) events.push(event);
    expect(toolRuntime.execute).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe("run.error");
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), expect.arrayContaining([expect.objectContaining({ status: "error" })]));

    const resultStorage = fakeStorage();
    const resultTools: AgentToolRuntime = { listTools: () => [{ name: "bad", description: "", inputSchema: {} }], execute: vi.fn(async () => cyclic) };
    const resultProvider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", [{ type: "tool.call", call: { id: "valid", name: "bad", arguments: {} } }, { type: "done" }]),
      supportsTools: () => true,
    };
    const resultRuntime = new AgentRuntime(registryWith([resultProvider], "fake"), resultStorage, new ProviderRouter(routingConfig), { toolRuntime: resultTools });
    const resultEvents = [];
    for await (const event of resultRuntime.runTurn("chat-1", "hi")) resultEvents.push(event);
    expect(resultEvents.at(-1)?.type).toBe("run.error");
    expect(resultStorage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), [
      { toolName: "bad", arguments: "{}", result: null, status: "error" },
    ]);
  });

  it("requires tools in auto routing and skips calls over the injected iteration limit", async () => {
    const storage = fakeStorage();
    let turn = 0;
    const provider: LlmProvider = {
      ...fakeProvider("fake", "fake-model", []), supportsTools: () => true,
      async *chat() {
        yield { type: "tool.call", call: { id: `c${++turn}`, name: "lookup", arguments: {} } };
        yield { type: "done" };
      },
    };
    const router = new ProviderRouter(routingConfig);
    const resolve = vi.spyOn(router, "resolveProviderId");
    const toolRuntime: AgentToolRuntime = { listTools: () => [{ name: "lookup", description: "", inputSchema: {} }], execute: vi.fn(async () => true) };
    const runtime = new AgentRuntime(registryWith([provider], "fake"), storage, router, { toolRuntime, maxToolIterations: 1 });
    const events = [];
    for await (const event of runtime.runTurn("chat-1", "hi", { mode: "auto", routingContext: { activeSkill: "skill", hasImageAttachment: true } })) events.push(event);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ toolsRequired: true, activeSkill: "skill", hasImageAttachment: true }));
    expect(toolRuntime.execute).toHaveBeenCalledOnce();
    expect(events.at(-1)?.type).toBe("run.error");
    expect(storage.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }), [
      { toolName: "lookup", arguments: "{}", result: "true", status: "success" },
      { toolName: "lookup", arguments: "{}", result: null, status: "skipped" },
    ]);
  });
});
