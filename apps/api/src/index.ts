// apps/api/src/index.ts
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRuntime, ProviderRouter } from "@agenter/agent-core";
import { SqliteChatStorage } from "@agenter/storage";
import { SkillRegistry } from "@agenter/skills";
import { buildLocalToolRegistry } from "./localTools.js";
import { buildProviderRegistry } from "./providerFactory.js";
import { ChatService } from "./services/ChatService.js";
import { createChatsRouter } from "./routes/chats.js";
import { createProvidersRouter } from "./routes/providers.js";
import { createSkillsRouter } from "./routes/skills.js";
import { createMessagesRouter } from "./routes/messages.js";
import { McpManager } from "@agenter/mcp";
import { SettingsStore, resolveSettings, resolveServers, type Settings } from "./settings.js";
import { createContextRouter, createSettingsRouter } from "./routes/settings.js";
import { createMcpRouter } from "./routes/mcp.js";
import { registerMcpShutdownHandlers } from "./mcpLifecycle.js";
import { createAgentToolRuntime } from "./agentToolRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const settingsStore = new SettingsStore(path.resolve(__dirname, "../../../config"));
const config = { ...resolveSettings(settingsStore.read()), port: Number(process.env.PORT ?? "3000"), dbPath: process.env.DB_PATH ?? "./data/agenter.db" };

const storage = new SqliteChatStorage(config.dbPath);

const skillsDir = path.resolve(__dirname, "../../../skills");
const skillRegistry = new SkillRegistry(skillsDir);
skillRegistry.scan();

const managers = new Set<McpManager>();
async function buildState(settings: Settings) {
  const resolved = resolveSettings(settings);
  const registry = buildProviderRegistry(resolved);
  const tools = buildLocalToolRegistry();
  const manager = new McpManager(tools);
  await manager.start(resolveServers(settings));
  managers.add(manager);
  const runtime = new AgentRuntime(registry, storage, new ProviderRouter(resolved.routing), { systemPrompt: settings.systemPrompt, toolRuntime: createAgentToolRuntime(tools), contextStorage: storage });
  return { registry, tools, manager, runtime, active: 0, retired: false };
}
let state = await buildState(settingsStore.read());
function retire(previous: typeof state): void {
  if (previous.retired && previous.active === 0) {
    managers.delete(previous.manager);
    void previous.manager.stop().catch(() => undefined);
  }
}
const chatService = new ChatService(storage, () => {
  const snapshot = state; snapshot.active++;
  return { runtime: snapshot.runtime, tools: snapshot.tools, release() { snapshot.active--; retire(snapshot); } };
}, skillRegistry);

const app = express();
app.locals.tools = state.tools;
app.use(express.json({ limit: "4mb" }));

app.use("/api/chats", createChatsRouter(chatService));
app.use("/api/chats", createMessagesRouter(chatService));
app.use("/api/providers", createProvidersRouter(() => state.registry));
app.use("/api/skills", createSkillsRouter(skillRegistry));
app.use("/api/mcp", createMcpRouter(() => state.manager));
app.use("/api/context", createContextRouter(chatService));
app.use("/api/settings", createSettingsRouter(settingsStore, async (settings) => {
  const next = await buildState(settings);
  const previous = state; state = next; app.locals.tools = state.tools;
  previous.retired = true; retire(previous);
}));

const server = app.listen(config.port, () => {
  console.log(`agenter api listening on http://localhost:${config.port}`);
});
registerMcpShutdownHandlers(server, { stop: async () => { await Promise.allSettled([...managers].map((manager) => manager.stop())); } }, process);
