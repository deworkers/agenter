// apps/api/src/services/ChatService.test.ts
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, Chat, ChatStorage, StoredMessage } from "@agenter/agent-core";
import { ChatService } from "./ChatService.js";

function fakeStorage(chats: Chat[] = [], messagesByChat: Record<string, StoredMessage[]> = {}): ChatStorage {
  return {
    createChat: vi.fn((title: string) => {
      const chat: Chat = { id: "new-id", title, createdAt: "t", updatedAt: "t" };
      chats.push(chat);
      return chat;
    }),
    listChats: vi.fn(() => chats),
    getChat: vi.fn((id: string) => chats.find((c) => c.id === id)),
    deleteChat: vi.fn((id: string) => {
      const idx = chats.findIndex((c) => c.id === id);
      if (idx >= 0) chats.splice(idx, 1);
    }),
    touchChat: vi.fn(),
    listMessages: vi.fn((chatId: string) => messagesByChat[chatId] ?? []),
    addMessage: vi.fn(),
    addRun: vi.fn(),
  };
}

function fakeRuntime(events: AgentEvent[]) {
  return {
    runTurn: vi.fn(async function* () {
      for (const event of events) yield event;
    }),
  };
}

describe("ChatService", () => {
  it("creates a chat with a default title when none is given", () => {
    const storage = fakeStorage();
    const service = new ChatService(storage, fakeRuntime([]) as never);

    const chat = service.createChat();

    expect(storage.createChat).toHaveBeenCalledWith("New chat");
    expect(chat.id).toBe("new-id");
  });

  it("lists chats via storage", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const storage = fakeStorage([existing]);
    const service = new ChatService(storage, fakeRuntime([]) as never);

    expect(service.listChats()).toEqual([existing]);
  });

  it("returns chat with messages, or undefined if the chat does not exist", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const message: StoredMessage = {
      id: "m1",
      chatId: "c1",
      role: "user",
      content: "hi",
      provider: null,
      model: null,
      createdAt: "t",
    };
    const storage = fakeStorage([existing], { c1: [message] });
    const service = new ChatService(storage, fakeRuntime([]) as never);

    expect(service.getChatWithMessages("c1")).toEqual({ chat: existing, messages: [message] });
    expect(service.getChatWithMessages("missing")).toBeUndefined();
  });

  it("deletes a chat via storage", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const storage = fakeStorage([existing]);
    const service = new ChatService(storage, fakeRuntime([]) as never);

    service.deleteChat("c1");

    expect(storage.deleteChat).toHaveBeenCalledWith("c1");
  });

  it("delegates sendMessage to AgentRuntime.runTurn and forwards its events", async () => {
    const events: AgentEvent[] = [
      { type: "run.started", provider: "p", model: "m" },
      { type: "text.delta", text: "hi" },
      { type: "run.completed" },
    ];
    const storage = fakeStorage();
    const runtime = fakeRuntime(events);
    const service = new ChatService(storage, runtime as never);

    const received: AgentEvent[] = [];
    for await (const event of service.sendMessage("c1", "hello")) {
      received.push(event);
    }

    expect(received).toEqual(events);
    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "hello", undefined);
  });
});
