import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./AgentRuntime.js";
import type { ChatStorage, LlmEvent, LlmProvider, LlmRequest, StoredMessage } from "./types.js";

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

function fakeProvider(events: LlmEvent[]): LlmProvider {
  return {
    id: "fake",
    model: "fake-model",
    supportsTools: () => false,
    supportsVision: () => false,
    getContextWindow: () => 8192,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async *chat(_request: LlmRequest): AsyncIterable<LlmEvent> {
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe("AgentRuntime.runTurn", () => {
  it("emits run.started, forwards text deltas, then run.completed, and persists both messages", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider([
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "done", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);
    const runtime = new AgentRuntime(provider, storage, "You are helpful.");

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

  it("emits run.error and does not persist an assistant message when the provider errors", async () => {
    const storage = fakeStorage();
    const provider = fakeProvider([{ type: "error", message: "upstream down" }]);
    const runtime = new AgentRuntime(provider, storage, "You are helpful.");

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
