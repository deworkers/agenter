// apps/api/src/index.ts
import express from "express";
import { AgentRuntime } from "@agenter/agent-core";
import { SqliteChatStorage } from "@agenter/storage";
import { OpenAICompatibleProvider } from "@agenter/provider-openai-compatible";
import { loadConfig } from "./config.js";
import { ChatService } from "./services/ChatService.js";
import { createChatsRouter } from "./routes/chats.js";
import { createProvidersRouter } from "./routes/providers.js";
import { createMessagesRouter } from "./routes/messages.js";

const config = loadConfig();

const storage = new SqliteChatStorage(config.dbPath);
const provider = new OpenAICompatibleProvider(config.provider);
const runtime = new AgentRuntime(provider, storage);
const chatService = new ChatService(storage, runtime);

const app = express();
app.use(express.json());

app.use("/api/chats", createChatsRouter(chatService));
app.use("/api/chats", createMessagesRouter(chatService));
app.use("/api/providers", createProvidersRouter(provider));

app.listen(config.port, () => {
  console.log(`agenter api listening on http://localhost:${config.port}`);
});
