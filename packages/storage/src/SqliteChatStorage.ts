// packages/storage/src/SqliteChatStorage.ts
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  Chat,
  ChatStorage,
  NewMessageInput,
  NewRunInput,
  RunRecord,
  StoredMessage,
} from "@agenter/agent-core";
import { SCHEMA_SQL } from "./schema.js";

export class SqliteChatStorage implements ChatStorage {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  createChat(title: string): Chat {
    const now = new Date().toISOString();
    const chat: Chat = { id: randomUUID(), title, createdAt: now, updatedAt: now };

    this.db
      .prepare(`INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(chat.id, chat.title, chat.createdAt, chat.updatedAt);

    return chat;
  }

  listChats(): Chat[] {
    const rows = this.db
      .prepare(`SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC`)
      .all() as Array<{ id: string; title: string; created_at: string; updated_at: string }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getChat(id: string): Chat | undefined {
    const row = this.db
      .prepare(`SELECT id, title, created_at, updated_at FROM chats WHERE id = ?`)
      .get(id) as { id: string; title: string; created_at: string; updated_at: string } | undefined;

    if (!row) return undefined;

    return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  deleteChat(id: string): void {
    this.db.prepare(`DELETE FROM chats WHERE id = ?`).run(id);
  }

  touchChat(id: string): void {
    this.db
      .prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }

  listMessages(chatId: string): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, chat_id, role, content, provider, model, created_at
         FROM messages WHERE chat_id = ? ORDER BY rowid ASC`
      )
      .all(chatId) as Array<{
        id: string;
        chat_id: string;
        role: string;
        content: string;
        provider: string | null;
        model: string | null;
        created_at: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      role: row.role as StoredMessage["role"],
      content: row.content,
      provider: row.provider,
      model: row.model,
      createdAt: row.created_at,
    }));
  }

  addMessage(input: NewMessageInput): StoredMessage {
    const message: StoredMessage = {
      id: randomUUID(),
      chatId: input.chatId,
      role: input.role,
      content: input.content,
      provider: input.provider ?? null,
      model: input.model ?? null,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO messages (id, chat_id, role, content, provider, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.chatId,
        message.role,
        message.content,
        message.provider,
        message.model,
        message.createdAt
      );

    return message;
  }

  addRun(input: NewRunInput): RunRecord {
    const run: RunRecord = {
      id: randomUUID(),
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

    this.db
      .prepare(
        `INSERT INTO runs (id, chat_id, message_id, provider, model, status, tokens_in, tokens_out, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.chatId,
        run.messageId,
        run.provider,
        run.model,
        run.status,
        run.tokensIn,
        run.tokensOut,
        run.durationMs,
        run.createdAt
      );

    return run;
  }
}
