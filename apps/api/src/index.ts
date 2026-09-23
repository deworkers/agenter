// apps/api/src/index.ts
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRuntime, ProviderRouter } from "@agenter/agent-core";
import { SqliteChatStorage } from "@agenter/storage";
import { SkillRegistry } from "@agenter/skills";
import { loadConfig } from "./config.js";
import { buildProviderRegistry } from "./providerFactory.js";
import { ChatService } from "./services/ChatService.js";
import { createChatsRouter } from "./routes/chats.js";
import { createProvidersRouter } from "./routes/providers.js";
import { createSkillsRouter } from "./routes/skills.js";
import { createMessagesRouter } from "./routes/messages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = loadConfig();

const storage = new SqliteChatStorage(config.dbPath);
const registry = buildProviderRegistry(config);
const router = new ProviderRouter(config.routing);
const runtime = new AgentRuntime(registry, storage, router);

const skillsDir = path.resolve(__dirname, "../../../skills");
const skillRegistry = new SkillRegistry(skillsDir);
skillRegistry.scan();

const chatService = new ChatService(storage, runtime, skillRegistry);

const app = express();
app.use(express.json());

app.use("/api/chats", createChatsRouter(chatService));
app.use("/api/chats", createMessagesRouter(chatService));
app.use("/api/providers", createProvidersRouter(registry));
app.use("/api/skills", createSkillsRouter(skillRegistry));

app.listen(config.port, () => {
  console.log(`agenter api listening on http://localhost:${config.port}`);
});
