import { Router } from "express";
import { validateAttachments, validateResponseFormat } from "@agenter/agent-core";
import { testMcpConnection } from "@agenter/mcp";
import { interpolateEnv } from "../config.js";
import { resolveServers, resolveSettings, SettingsStore, validateSettings, type Settings } from "../settings.js";
import type { ChatService } from "../services/ChatService.js";

export function createSettingsRouter(store: SettingsStore, apply: (settings: Settings) => Promise<void>): Router {
  const router = Router();
  let saving = false;
  router.get("/", (_req, res) => {
    try {
      const settings = store.read();
      const keys = Object.values(settings.providers).map(({ apiKey }) => apiKey.match(/^\$\{([A-Z0-9_]+)\}$/)?.[1]).filter((key): key is string => !!key);
      res.json({ settings, environment: Object.fromEntries(keys.map((key) => [key, !!process.env[key]])) });
    } catch { res.status(500).json({ error: "Не удалось прочитать настройки" }); }
  });
  router.put("/", async (req, res) => {
    if (saving) { res.status(409).json({ error: "Настройки уже применяются" }); return; }
    saving = true;
    try {
      const settings = validateSettings(req.body);
      // Resolve all active boundaries before replacing the working configuration.
      resolveSettings(settings); resolveServers(settings);
      const previous = store.read();
      store.save(settings);
      try { await apply(settings); } catch (error) { store.save(previous, false); throw error; }
      res.json({ settings });
    } catch (error) {
      res.status(400).json({ error: error instanceof RangeError ? error.message : "Не удалось применить настройки. Проверьте ссылки на переменные окружения." });
    } finally { saving = false; }
  });
  router.post("/test", async (req, res) => {
    try {
      const settings = validateSettings(req.body.settings);
      if (req.body.kind === "model") {
        const entry = settings.providers[req.body.id as string];
        if (!entry) throw new RangeError("Модель не найдена");
        const response = await fetch(`${entry.baseUrl.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${interpolateEnv(entry.apiKey)}` }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error();
        res.json({ ok: true });
      } else if (req.body.kind === "mcp") {
        const entry = resolveServers(settings)[req.body.id as string];
        if (!entry) throw new RangeError("Включите MCP-сервер для проверки");
        res.json({ ok: true, tools: await testMcpConnection(entry) });
      } else throw new RangeError("Неизвестный тип проверки");
    } catch (error) { res.status(400).json({ error: error instanceof RangeError ? error.message : "Подключение не удалось: проверьте адрес, доступность и переменные окружения" }); }
  });
  return router;
}

export function createContextRouter(service: ChatService): Router {
  const router = Router();
  router.post("/", (req, res) => {
    const { chatId = "", content = "", providerId, mode, skillId, mcpServerIds = [], historyLimit } = req.body ?? {};
    if (typeof chatId !== "string" || typeof content !== "string" || content.length > 100000 || !Array.isArray(mcpServerIds) || !mcpServerIds.every((id) => typeof id === "string") || (historyLimit !== undefined && (!Number.isInteger(historyLimit) || historyLimit < 0 || historyLimit > 100000))) { res.status(400).json({ error: "Некорректный запрос контекста" }); return; }
    try {
      const attachments = validateAttachments(req.body?.attachments);
      const responseFormat = validateResponseFormat(req.body?.responseFormat);
      res.json(service.preview(chatId, content, { providerId, mode, skillId, mcpServerIds, historyLimit, ...(attachments.length ? { attachments } : {}), ...(responseFormat ? { responseFormat } : {}) }));
    } catch (error) { res.status(400).json({ error: error instanceof RangeError ? error.message : "Контекст недоступен. Проверьте модель и навык." }); }
  });
  return router;
}
