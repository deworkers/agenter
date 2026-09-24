// packages/storage/src/SqliteChatStorage.test.ts
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
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

  it("atomically records a run and its tool calls", () => {
    const chat = storage.createChat("My chat");
    const userMessage = storage.addMessage({ chatId: chat.id, role: "user", content: "hi" });
    const db = (storage as unknown as { db: DatabaseSync }).db;
    const oldTimestamp = "2000-01-01T00:00:00.000Z";
    db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(oldTimestamp, chat.id);

    const run = storage.completeRun(
      {
        chatId: chat.id,
        messageId: userMessage.id,
        provider: "local-fast",
        model: "qwen3",
        status: "success",
        durationMs: 120,
      },
      [
        { toolName: "lookup", arguments: '{"query":"x"}', result: '{"value":1}', status: "success" },
        { toolName: "later", arguments: "{}", result: null, status: "skipped" },
      ],
      { chatId: chat.id, role: "assistant", content: "Found it", provider: "local-fast", model: "qwen3" }
    );
    const rows = db
      .prepare(
        `SELECT run_id, tool_name, arguments, result, status FROM tool_calls ORDER BY rowid ASC`
      )
      .all() as Array<{
      run_id: string;
      tool_name: string;
      arguments: string;
      result: string | null;
      status: string;
    }>;

    expect(run.status).toBe("success");
    expect(run.messageId).toBe(userMessage.id);
    expect(storage.listMessages(chat.id).at(-1)).toMatchObject({
      chatId: chat.id,
      role: "assistant",
      content: "Found it",
      provider: "local-fast",
      model: "qwen3",
    });
    expect(storage.getChat(chat.id)?.updatedAt).not.toBe(oldTimestamp);
    expect(rows).toEqual([
      {
        run_id: run.id,
        tool_name: "lookup",
        arguments: '{"query":"x"}',
        result: '{"value":1}',
        status: "success",
      },
      { run_id: run.id, tool_name: "later", arguments: "{}", result: null, status: "skipped" },
    ]);
  });

  it("does not persist an assistant message for an error run without assistant input", () => {
    const chat = storage.createChat("My chat");
    const userMessage = storage.addMessage({ chatId: chat.id, role: "user", content: "hi" });

    const run = storage.completeRun(
      {
        chatId: chat.id,
        messageId: userMessage.id,
        provider: "local-fast",
        model: "qwen3",
        status: "error",
        durationMs: 120,
      },
      []
    );

    expect(run.status).toBe("error");
    expect(storage.listMessages(chat.id)).toEqual([userMessage]);
  });

  it("rolls back the assistant, run, tool calls, and chat timestamp if a tool-call insert fails", () => {
    const chat = storage.createChat("My chat");
    const userMessage = storage.addMessage({ chatId: chat.id, role: "user", content: "hi" });
    const db = (storage as unknown as { db: DatabaseSync }).db;
    const oldTimestamp = "2000-01-01T00:00:00.000Z";
    db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(oldTimestamp, chat.id);

    expect(() =>
      storage.completeRun(
        {
          chatId: chat.id,
          messageId: userMessage.id,
          provider: "local-fast",
          model: "qwen3",
          status: "error",
          durationMs: 120,
        },
        [
          { toolName: "valid", arguments: "{}", result: "{}", status: "success" },
          { toolName: null as unknown as string, arguments: "{}", result: null, status: "skipped" },
        ],
        { chatId: chat.id, role: "assistant", content: "must roll back" }
      )
    ).toThrow(/NOT NULL constraint failed: tool_calls\.tool_name/);

    const runCount = db.prepare("SELECT COUNT(*) AS count FROM runs").get() as { count: number };
    const toolCallCount = db.prepare("SELECT COUNT(*) AS count FROM tool_calls").get() as { count: number };
    const assistantCount = db
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND role = 'assistant'")
      .get(chat.id) as { count: number };
    expect(runCount.count).toBe(0);
    expect(toolCallCount.count).toBe(0);
    expect(assistantCount.count).toBe(0);
    expect(storage.getChat(chat.id)?.updatedAt).toBe(oldTimestamp);
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
