import express, { Router, type ErrorRequestHandler } from "express";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { AgentRuntime, MAX_SELF_CHECK_CONTINUATIONS, ProviderRouter } from "@agenter/agent-core";
import { SqliteChatStorage } from "@agenter/storage";
import { SkillRegistry } from "@agenter/skills";
import { McpManager } from "@agenter/mcp";
import { buildLocalToolRegistry } from "./localTools.js";
import { buildProviderRegistry } from "./providerFactory.js";
import { ChatService } from "./services/ChatService.js";
import { createChatsRouter } from "./routes/chats.js";
import { createProvidersRouter } from "./routes/providers.js";
import { createSkillsRouter } from "./routes/skills.js";
import { createMessagesRouter } from "./routes/messages.js";
import { SettingsStore, resolveSettings, resolveServers, type Settings } from "./settings.js";
import { createContextRouter, createSettingsRouter } from "./routes/settings.js";
import { createMcpRouter } from "./routes/mcp.js";
import { createAgentToolRuntime } from "./agentToolRuntime.js";
import { AuthStore } from "./auth.js";
import { createAuthRouter, sameOrigin, sessionToken } from "./routes/auth.js";

export interface ApplicationOptions {
  configDirectory: string;
  skillsDirectory: string;
  dbPath: string;
  secureCookies?: boolean;
}

export async function createApplication(options: ApplicationOptions) {
  // Settings, skills, providers and MCP processes are shared; only storage is per user.
  const settingsStore = new SettingsStore(options.configDirectory);
  const dbPath = path.resolve(options.dbPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const authPath = path.join(path.dirname(dbPath), `${path.basename(dbPath)}.auth.db`);
  const auth = new AuthStore(authPath);
  const skills = new SkillRegistry(options.skillsDirectory); skills.scan();
  const managers = new Set<McpManager>();
  const storages = new Map<string, SqliteChatStorage>();
  const userRouters = new Map<string, Router>();
  async function buildState(settings: Settings) {
    const resolved = resolveSettings(settings);
    const registry = buildProviderRegistry(resolved);
    const tools = buildLocalToolRegistry();
    const manager = new McpManager(tools);
    await manager.start(resolveServers(settings)); managers.add(manager);
    return { registry, tools, manager, settings, routing: new ProviderRouter(resolved.routing), active: 0, retired: false };
  }
  let state: Awaited<ReturnType<typeof buildState>>;
  try { state = await buildState(settingsStore.read()); }
  catch (error) { auth.close(); throw error; }
  function retire(previous: typeof state): void {
    if (previous.retired && previous.active === 0) {
      void previous.manager.stop().then(() => managers.delete(previous.manager)).catch(() => undefined);
    }
  }
  function routesFor(userId: string): Router {
    const cached = userRouters.get(userId); if (cached) return cached;
    const environmentDirectory = path.join(path.dirname(dbPath), `${path.basename(dbPath)}.environments`);
    mkdirSync(environmentDirectory, { recursive: true });
    const storage = new SqliteChatStorage(auth.isLegacyOwner(userId) ? dbPath : path.join(environmentDirectory, `${userId}.db`));
    storages.set(userId, storage);
    const service = new ChatService(storage, () => {
      const snapshot = state; snapshot.active++;
      const runtime = new AgentRuntime(snapshot.registry, storage, snapshot.routing, {
        systemPrompt: snapshot.settings.systemPrompt, toolRuntime: createAgentToolRuntime(snapshot.tools),
        contextStorage: storage, maxSelfCheckContinuations: MAX_SELF_CHECK_CONTINUATIONS,
      });
      return { runtime, tools: snapshot.tools, release() { snapshot.active--; retire(snapshot); } };
    }, skills);
    const router = Router();
    // Check existence before SSE headers or runtime calls, using only this user's storage.
    router.use("/chats/:id", (req, res, next) => {
      if (!service.getChatWithMessages(req.params.id)) { res.status(404).json({ error: "Чат не найден" }); return; }
      next();
    });
    router.use("/chats", createChatsRouter(service));
    router.use("/chats", createMessagesRouter(service));
    router.use("/context", (req, res, next) => {
      const id: unknown = req.body?.chatId;
      if (typeof id === "string" && id && !service.getChatWithMessages(id)) { res.status(404).json({ error: "Чат не найден" }); return; }
      next();
    }, createContextRouter(service));
    userRouters.set(userId, router); return router;
  }
  const app = express();
  app.use("/api", sameOrigin);
  app.use(express.json({ limit: "4mb" }));
  app.use("/api/auth", createAuthRouter(auth, options.secureCookies));
  app.use("/api", (req, res, next) => {
    const user = auth.findSession(sessionToken(req));
    if (!user) { res.status(401).json({ error: "Войдите в своё окружение" }); return; }
    res.locals.userId = user.id; next();
  });
  app.use("/api/providers", createProvidersRouter(() => state.registry));
  app.use("/api/skills", createSkillsRouter(skills));
  app.use("/api/mcp", createMcpRouter(() => state.manager));
  app.use("/api/settings", createSettingsRouter(settingsStore, async settings => {
    const next = await buildState(settings);
    const previous = state; state = next; previous.retired = true; retire(previous);
  }));
  app.use("/api", (req, res, next) => routesFor(res.locals.userId as string)(req, res, next));
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    void _next; // Express identifies error middleware by its four arguments.
    if (res.headersSent) { res.end(); return; }
    res.status(error instanceof SyntaxError ? 400 : 500).json({ error: error instanceof SyntaxError ? "Некорректный JSON" : "Не удалось выполнить запрос" });
  };
  app.use(handleError);
  return {
    app,
    async close() {
      await Promise.allSettled([...managers].map(manager => manager.stop()));
      for (const storage of storages.values()) storage.close();
      auth.close();
    },
  };
}
