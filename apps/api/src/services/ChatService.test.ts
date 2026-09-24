// apps/api/src/services/ChatService.test.ts
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, Chat, ChatStorage, StoredMessage } from "@agenter/agent-core";
import type { SkillRegistry } from "@agenter/skills";
import { ToolRegistry } from "@agenter/tools";
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
    completeRun: vi.fn(),
  };
}

function fakeRuntime(events: AgentEvent[]) {
  return {
    runTurn: vi.fn(async function* () {
      for (const event of events) yield event;
    }),
  };
}

function fakeSkillRegistry(content: Record<string, string> = {}): SkillRegistry {
  return {
    scan: vi.fn(),
    list: vi.fn(() => []),
    getContent: vi.fn((id: string) => content[id]),
  } as unknown as SkillRegistry;
}

describe("ChatService", () => {
  it("disables MCP by default and includes only selected ready servers alongside local tools", async () => {
    const registry = new ToolRegistry();
    for (const [name, source] of [
      ["local", { kind: "local" }],
      ["files__read", { kind: "mcp", serverId: "files" }],
      ["search__find", { kind: "mcp", serverId: "search" }],
    ] as const) {
      registry.register({ name, source, description: name, inputSchema: {}, safety: "safe", execute: vi.fn() });
    }
    const runtime = fakeRuntime([]);
    const service = new ChatService(fakeStorage(), runtime as never, fakeSkillRegistry(), registry);
    for await (const event of service.sendMessage("c1", "first")) void event;
    for await (const event of service.sendMessage("c1", "second", { mcpServerIds: ["files"] })) void event;

    expect(runtime.runTurn).toHaveBeenNthCalledWith(1, "c1", "first", { allowedToolNames: ["local"] });
    expect(runtime.runTurn).toHaveBeenNthCalledWith(2, "c1", "second", { allowedToolNames: ["files__read", "local"] });
  });

  it("creates a chat with a default title when none is given", () => {
    const storage = fakeStorage();
    const service = new ChatService(storage, fakeRuntime([]) as never, fakeSkillRegistry());

    const chat = service.createChat();

    expect(storage.createChat).toHaveBeenCalledWith("New chat");
    expect(chat.id).toBe("new-id");
  });

  it("lists chats via storage", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const storage = fakeStorage([existing]);
    const service = new ChatService(storage, fakeRuntime([]) as never, fakeSkillRegistry());

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
    const service = new ChatService(storage, fakeRuntime([]) as never, fakeSkillRegistry());

    expect(service.getChatWithMessages("c1")).toEqual({ chat: existing, messages: [message] });
    expect(service.getChatWithMessages("missing")).toBeUndefined();
  });

  it("deletes a chat via storage", () => {
    const existing: Chat = { id: "c1", title: "Existing", createdAt: "t", updatedAt: "t" };
    const storage = fakeStorage([existing]);
    const service = new ChatService(storage, fakeRuntime([]) as never, fakeSkillRegistry());

    service.deleteChat("c1");

    expect(storage.deleteChat).toHaveBeenCalledWith("c1");
  });

  it("delegates sendMessage to AgentRuntime.runTurn and forwards its events", async () => {
    const events: AgentEvent[] = [
      { type: "run.started", provider: "p", model: "m" },
      { type: "tool.started", tool: "lookup", arguments: { query: "x" } },
      { type: "tool.completed", tool: "lookup", result: { value: 1 } },
      { type: "text.delta", text: "hi" },
      { type: "run.completed" },
    ];
    const storage = fakeStorage();
    const runtime = fakeRuntime(events);
    const service = new ChatService(storage, runtime as never, fakeSkillRegistry());

    const received: AgentEvent[] = [];
    for await (const event of service.sendMessage("c1", "hello")) {
      received.push(event);
    }

    expect(received).toEqual(events);
    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "hello", { allowedToolNames: [] });
  });

  it("forwards providerId, mode, and routingContext options to AgentRuntime.runTurn when no skillId is given", async () => {
    const storage = fakeStorage();
    const runtime = fakeRuntime([]);
    const service = new ChatService(storage, runtime as never, fakeSkillRegistry());

    const options = { mode: "auto" as const, routingContext: { toolsRequired: true } };
    const received: AgentEvent[] = [];
    for await (const event of service.sendMessage("c1", "hello", options)) {
      received.push(event);
    }

    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "hello", { ...options, allowedToolNames: [] });
  });

  it("resolves skillId into activeSkillContent and sets routingContext.activeSkill", async () => {
    const storage = fakeStorage();
    const runtime = fakeRuntime([]);
    const skills = fakeSkillRegistry({ "code-review": "# Code Review\n\nInspect correctness." });
    const service = new ChatService(storage, runtime as never, skills);

    const received: AgentEvent[] = [];
    for await (const event of service.sendMessage("c1", "review this", {
      mode: "auto",
      skillId: "code-review",
    })) {
      received.push(event);
    }

    expect(skills.getContent).toHaveBeenCalledWith("code-review");
    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "review this", {
      mode: "auto",
      allowedToolNames: [],
      activeSkillId: "code-review",
      activeSkillContent: "# Code Review\n\nInspect correctness.",
      routingContext: { activeSkill: "code-review" },
    });
  });

  it("merges activeSkill into an existing routingContext without dropping other fields", async () => {
    const storage = fakeStorage();
    const runtime = fakeRuntime([]);
    const skills = fakeSkillRegistry({ "code-review": "# Code Review" });
    const service = new ChatService(storage, runtime as never, skills);

    const received: AgentEvent[] = [];
    for await (const event of service.sendMessage("c1", "review this", {
      mode: "auto",
      skillId: "code-review",
      routingContext: { toolsRequired: true },
    })) {
      received.push(event);
    }

    expect(runtime.runTurn).toHaveBeenCalledWith("c1", "review this", {
      mode: "auto",
      allowedToolNames: [],
      activeSkillId: "code-review",
      activeSkillContent: "# Code Review",
      routingContext: { toolsRequired: true, activeSkill: "code-review" },
    });
  });

  it("throws when skillId does not match a registered skill, without calling runTurn", async () => {
    const storage = fakeStorage();
    const runtime = fakeRuntime([]);
    const service = new ChatService(storage, runtime as never, fakeSkillRegistry());

    const drain = async () => {
      const stream = service.sendMessage("c1", "hi", { skillId: "missing" });
      // draining the generator to trigger the throw
      let step = await stream.next();
      while (!step.done) {
        step = await stream.next();
      }
    };

    await expect(drain()).rejects.toThrow('Unknown skill "missing"');
    expect(runtime.runTurn).not.toHaveBeenCalled();
  });
});
