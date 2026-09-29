// packages/storage/src/SqliteChatStorage.ts
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  Chat,
  ChatStorage,
  NewMessageInput,
  NewRunInput,
  NewToolCallInput,
  RunRecord,
  StoredMessage,
  ContextCheckpoint,
  ContextCheckpointStorage,
} from "@agenter/agent-core";
import { SCHEMA_SQL } from "./schema.js";

export class SqliteChatStorage implements ChatStorage, ContextCheckpointStorage {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA_SQL);
    const columns = this.db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    if (!columns.some(({ name }) => name === "assistant_message_id")) this.db.exec("ALTER TABLE runs ADD COLUMN assistant_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL");
    this.db.exec(`UPDATE runs SET assistant_message_id = (
      SELECT a.id FROM messages a WHERE a.chat_id = runs.chat_id AND a.role = 'assistant'
      AND a.rowid > (SELECT rowid FROM messages WHERE id = runs.message_id)
      AND a.rowid < COALESCE((SELECT MIN(rowid) FROM messages WHERE chat_id = runs.chat_id AND role = 'user' AND rowid > (SELECT rowid FROM messages WHERE id = runs.message_id)), 9223372036854775807)
      ORDER BY a.rowid LIMIT 1) WHERE status = 'success' AND assistant_message_id IS NULL`);
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
      .prepare(`SELECT chats.id, COALESCE((SELECT COALESCE(NULLIF(trim(replace(replace(content, char(10), ' '), char(13), ' ')), ''),
        (SELECT json_extract(payload, '$.attachments[0].name') FROM message_documents WHERE message_id = messages.id), 'Вложения')
        FROM messages WHERE chat_id = chats.id AND role = 'user' ORDER BY rowid DESC LIMIT 1), chats.title) AS title,
        chats.created_at, chats.updated_at FROM chats ORDER BY chats.updated_at DESC`)
      .all() as Array<{ id: string; title: string; created_at: string; updated_at: string }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title.replace(/\s+/g, " ").trim(),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getChat(id: string): Chat | undefined {
    const row = this.db
      .prepare(`SELECT chats.id, COALESCE((SELECT COALESCE(NULLIF(trim(replace(replace(content, char(10), ' '), char(13), ' ')), ''),
        (SELECT json_extract(payload, '$.attachments[0].name') FROM message_documents WHERE message_id = messages.id), 'Вложения')
        FROM messages WHERE chat_id = chats.id AND role = 'user' ORDER BY rowid DESC LIMIT 1), chats.title) AS title,
        chats.created_at, chats.updated_at FROM chats WHERE chats.id = ?`)
      .get(id) as { id: string; title: string; created_at: string; updated_at: string } | undefined;

    if (!row) return undefined;

    return { id: row.id, title: row.title.replace(/\s+/g, " ").trim(), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  deleteChat(id: string): void {
    this.db.prepare(`DELETE FROM chats WHERE id = ?`).run(id);
  }

  touchChat(id: string): void {
    this.db.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  getContextCheckpoint(chatId: string): ContextCheckpoint | undefined {
    const row = this.db.prepare("SELECT through_message_id, summary FROM chat_context_checkpoints WHERE chat_id = ?").get(chatId) as { through_message_id: string; summary: string } | undefined;
    return row ? { throughMessageId: row.through_message_id, summary: row.summary } : undefined;
  }

  saveContextCheckpoint(chatId: string, checkpoint: ContextCheckpoint): void {
    if (!checkpoint.summary.trim() || checkpoint.summary.length > 100_000 || !this.db.prepare("SELECT id FROM messages WHERE id = ? AND chat_id = ?").get(checkpoint.throughMessageId, chatId)) throw new RangeError("Invalid context checkpoint");
    this.db.prepare("INSERT INTO chat_context_checkpoints (chat_id, through_message_id, summary) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET through_message_id = excluded.through_message_id, summary = excluded.summary").run(chatId, checkpoint.throughMessageId, checkpoint.summary);
  }

  listMessages(chatId: string): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT messages.id, chat_id, role, content, provider, model, created_at, message_contexts.payload AS context_json,
         message_documents.payload AS documents_json
         FROM messages LEFT JOIN message_contexts ON message_contexts.message_id = messages.id
         LEFT JOIN message_documents ON message_documents.message_id = messages.id
         WHERE chat_id = ? ORDER BY messages.rowid ASC`
      )
      .all(chatId) as Array<{
        id: string;
        chat_id: string;
        role: string;
        content: string;
        provider: string | null;
        model: string | null;
        created_at: string;
        context_json: string | null;
        documents_json: string | null;
      }>;

    const messages: StoredMessage[] = rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      role: row.role as StoredMessage["role"],
      content: row.content,
      provider: row.provider,
      model: row.model,
      createdAt: row.created_at,
      ...(row.context_json ? { context: JSON.parse(row.context_json) as StoredMessage["context"] } : {}),
      ...(row.documents_json ? JSON.parse(row.documents_json) as Pick<StoredMessage, "attachments" | "responseFormat"> : {}),
    }));
    const runs = this.db.prepare("SELECT id, message_id, assistant_message_id, provider, model, status, duration_ms, tokens_in, tokens_out, created_at FROM runs WHERE chat_id = ? ORDER BY rowid").all(chatId) as Array<{ id: string; message_id: string; assistant_message_id: string | null; provider: string; model: string; status: string; duration_ms: number; tokens_in: number | null; tokens_out: number | null; created_at: string }>;
    for (const run of runs) {
      let message = messages.find((item) => item.id === run.assistant_message_id);
      if (!message && run.status !== "success") {
        message = { id: `run-${run.id}`, chatId, role: "assistant", content: "", provider: run.provider, model: run.model, createdAt: run.created_at, error: "Запрос не завершён успешно." };
        const index = messages.findIndex((item) => item.id === run.message_id);
        messages.splice(index < 0 ? messages.length : index + 1, 0, message);
      }
      if (!message) continue;
      message.durationMs = run.duration_ms;
      if (run.tokens_in !== null && run.tokens_out !== null) message.usage = { promptTokens: run.tokens_in, completionTokens: run.tokens_out };
      const calls = this.db.prepare("SELECT tool_name, arguments, result, status FROM tool_calls WHERE run_id = ? ORDER BY rowid").all(run.id) as Array<{ tool_name: string; arguments: string; result: string | null; status: string }>;
      if (calls.length) message.tools = calls.map((call) => ({ name: call.tool_name, arguments: JSON.parse(call.arguments), ...(call.result ? { result: JSON.parse(call.result) } : {}), status: call.status === "success" ? "completed" : "error" }));
    }
    return messages;
  }

  addMessage(input: NewMessageInput): StoredMessage {
    const contextJson = input.context ? JSON.stringify(input.context) : undefined;
    const documents = {
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(input.responseFormat ? { responseFormat: input.responseFormat } : {}),
    };
    const documentsJson = Object.keys(documents).length ? JSON.stringify(documents) : undefined;
    const message: StoredMessage = {
      id: randomUUID(),
      chatId: input.chatId,
      role: input.role,
      content: input.content,
      provider: input.provider ?? null,
      model: input.model ?? null,
      createdAt: new Date().toISOString(),
      ...(input.context ? { context: input.context } : {}),
      ...documents,
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

    if (contextJson) {
      this.db.prepare(`INSERT INTO message_contexts (message_id, payload) VALUES (?, ?)`).run(message.id, contextJson);
    }
    if (documentsJson) this.db.prepare("INSERT INTO message_documents (message_id, payload) VALUES (?, ?)").run(message.id, documentsJson);
    if (input.role === "user") this.touchChat(input.chatId);

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

  completeRun(
    input: NewRunInput,
    toolCalls: NewToolCallInput[],
    assistantMessage?: NewMessageInput
  ): RunRecord {
    this.db.exec("BEGIN");
    try {
      let assistantId: string | undefined;
      if (assistantMessage) {
        assistantId = this.addMessage(assistantMessage).id;
        this.touchChat(assistantMessage.chatId);
      }

      const run = this.addRun(input);
      if (assistantId) this.db.prepare("UPDATE runs SET assistant_message_id = ? WHERE id = ?").run(assistantId, run.id);
      const insertToolCall = this.db.prepare(
        `INSERT INTO tool_calls (id, run_id, tool_name, arguments, result, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      for (const call of toolCalls) {
        insertToolCall.run(
          randomUUID(),
          run.id,
          call.toolName,
          call.arguments,
          call.result,
          call.status,
          new Date().toISOString()
        );
      }

      this.db.exec("COMMIT");
      return run;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
