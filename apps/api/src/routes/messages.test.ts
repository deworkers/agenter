import express from "express";
import { describe, expect, it, vi } from "vitest";
import {
  AgentRuntime,
  ProviderRegistry,
  ProviderRouter,
  type AgentEvent,
  type ChatStorage,
  type LlmProvider,
  type RoutingConfig,
  type StoredMessage,
} from "@agenter/agent-core";
import type { SkillRegistry } from "@agenter/skills";
import { ToolRegistry } from "@agenter/tools";
import { createAgentToolRuntime } from "../agentToolRuntime.js";
import { ChatService } from "../services/ChatService.js";
import { createMessagesRouter } from "./messages.js";

const routingConfig: RoutingConfig = {
  simple: { provider: "fake" },
  coding: { provider: "fake" },
  reasoning: { provider: "fake" },
  research: { provider: "fake" },
  vision: { provider: "fake" },
};

function memoryStorage(): ChatStorage {
  const messages: StoredMessage[] = [];
  return {
    createChat: vi.fn(),
    listChats: vi.fn(() => []),
    getChat: vi.fn(),
    deleteChat: vi.fn(),
    touchChat: vi.fn(),
    listMessages: vi.fn(() => [...messages]),
    addMessage: vi.fn((input) => {
      const message: StoredMessage = {
        id: `m${messages.length + 1}`,
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        provider: input.provider ?? null,
        model: input.model ?? null,
        createdAt: "2026-09-24T00:00:00.000Z",
      };
      messages.push(message);
      return message;
    }),
    addRun: vi.fn(),
    completeRun: vi.fn((input, _calls, assistantMessage) => {
      if (assistantMessage) {
        messages.push({
          id: `m${messages.length + 1}`,
          chatId: assistantMessage.chatId,
          role: assistantMessage.role,
          content: assistantMessage.content,
          provider: assistantMessage.provider ?? null,
          model: assistantMessage.model ?? null,
          createdAt: "2026-09-24T00:00:00.000Z",
        });
      }
      return {
        id: "run-1",
        chatId: input.chatId,
        messageId: input.messageId,
        provider: input.provider,
        model: input.model,
        status: input.status,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        durationMs: input.durationMs,
        createdAt: "2026-09-24T00:00:00.000Z",
      };
    }),
  };
}

describe("messages route tool events", () => {
  it("streams the neutral tool lifecycle before the final answer", async () => {
    let turn = 0;
    const provider: LlmProvider = {
      id: "fake",
      model: "fake-model",
      supportsTools: () => true,
      supportsVision: () => false,
      getContextWindow: () => 8192,
      async *chat() {
        if (turn++ === 0) {
          yield { type: "tool.call", call: { id: "call-1", name: "lookup", arguments: { query: "x" } } };
          yield { type: "done" };
          return;
        }
        yield { type: "text.delta", text: "Found it" };
        yield { type: "done" };
      },
    };
    const providers = new ProviderRegistry("fake");
    providers.register(provider);
    const tools = new ToolRegistry();
    tools.register({
      name: "lookup",
      description: "Look up a value",
      inputSchema: { type: "object" },
      safety: "safe",
      execute: vi.fn(async () => ({ value: 42 })),
    });
    const storage = memoryStorage();
    const runtime = new AgentRuntime(
      providers,
      storage,
      new ProviderRouter(routingConfig),
      { toolRuntime: createAgentToolRuntime(tools) }
    );
    const skills = { getContent: vi.fn() } as unknown as SkillRegistry;
    const service = new ChatService(storage, runtime, skills);
    const app = express();
    app.use(express.json());
    app.use("/api/chats", createMessagesRouter(service));
    const server = app.listen(0, "127.0.0.1");

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected loopback TCP address");

      const response = await fetch(`http://127.0.0.1:${address.port}/api/chats/chat-1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "find x" }),
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      const events = body
        .split("\n\n")
        .filter(Boolean)
        .map((frame) => JSON.parse(frame.replace(/^data: /, "")) as AgentEvent);

      expect(events.map(({ type }) => type)).toEqual([
        "run.started",
        "tool.started",
        "tool.completed",
        "text.delta",
        "run.completed",
      ]);
      expect(events[1]).toEqual({ type: "tool.started", tool: "lookup", arguments: { query: "x" } });
      expect(events[2]).toEqual({ type: "tool.completed", tool: "lookup", result: { value: 42 } });
      expect(body).not.toContain("tool_calls");
      expect(body).not.toContain("finish_reason");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
