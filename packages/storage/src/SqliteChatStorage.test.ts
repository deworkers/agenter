// packages/storage/src/SqliteChatStorage.test.ts
import { unlinkSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteChatStorage } from "./SqliteChatStorage.js";

describe("SqliteChatStorage", () => {
  let storage: SqliteChatStorage;

  beforeEach(() => {
    storage = new SqliteChatStorage(":memory:");
  });

  afterEach(() => {
    storage.close();
  });

  it("creates a chat and lists it", () => {
    const chat = storage.createChat("My chat");

    expect(chat.title).toBe("My chat");
    expect(storage.listChats()).toEqual([chat]);
    expect(storage.getChat(chat.id)).toEqual(chat);
  });

  it("adds messages and lists them in insertion order", () => {
    const chat = storage.createChat("My chat");

    storage.addMessage({ chatId: chat.id, role: "user", content: "hi" });
    storage.addMessage({
      chatId: chat.id,
      role: "assistant",
      content: "hello!",
      provider: "local-fast",
      model: "qwen3",
    });

    const messages = storage.listMessages(chat.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("hi");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.provider).toBe("local-fast");
  });

  it("deletes a chat and cascades its messages", () => {
    const chat = storage.createChat("My chat");
    storage.addMessage({ chatId: chat.id, role: "user", content: "hi" });

    storage.deleteChat(chat.id);

    expect(storage.getChat(chat.id)).toBeUndefined();
    expect(storage.listMessages(chat.id)).toEqual([]);
  });

  it("records a run linked to a message", () => {
    const chat = storage.createChat("My chat");
    const userMessage = storage.addMessage({ chatId: chat.id, role: "user", content: "hi" });

    const run = storage.addRun({
      chatId: chat.id,
      messageId: userMessage.id,
      provider: "local-fast",
      model: "qwen3",
      status: "success",
      tokensIn: 10,
      tokensOut: 5,
      durationMs: 120,
    });

    expect(run.status).toBe("success");
    expect(run.messageId).toBe(userMessage.id);
  });

  it("persists data across instances backed by the same file", () => {
    const filePath = `./.tmp-test-${Date.now()}.db`;
    const first = new SqliteChatStorage(filePath);
    const chat = first.createChat("Persisted chat");
    first.close();

    const second = new SqliteChatStorage(filePath);
    expect(second.getChat(chat.id)?.title).toBe("Persisted chat");
    second.close();

    unlinkSync(filePath);
  });
});
