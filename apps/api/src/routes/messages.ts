// apps/api/src/routes/messages.ts
import { Router } from "express";
import type { ChatService } from "../services/ChatService.js";

export function createMessagesRouter(chatService: ChatService): Router {
  const router = Router();

  router.post("/:id/messages", async (req, res) => {
    const content = req.body?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content must be a non-empty string" });
      return;
    }

    const providerId = typeof req.body?.providerId === "string" ? req.body.providerId : undefined;
    const mode = req.body?.mode === "auto" ? "auto" : req.body?.mode === "manual" ? "manual" : undefined;
    const skillId = typeof req.body?.skillId === "string" ? req.body.skillId : undefined;
    const mcpServerIds = req.body?.mcpServerIds;
    const historyLimit = req.body?.historyLimit;
    if (historyLimit !== undefined && (!Number.isInteger(historyLimit) || historyLimit < 0 || historyLimit > 100000)) { res.status(400).json({ error: "Некорректный лимит истории" }); return; }
    if (mcpServerIds !== undefined && (!Array.isArray(mcpServerIds) ||
      !mcpServerIds.every((id: unknown) => typeof id === "string" && id.length > 0))) {
      res.status(400).json({ error: "mcpServerIds must be an array of server IDs" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const abort = new AbortController();
    const disconnect = () => { if (!res.writableEnded) abort.abort(); };
    res.on("close", disconnect);

    try {
      for await (const event of chatService.sendMessage(req.params.id, content, { providerId, mode, skillId, mcpServerIds, historyLimit, signal: abort.signal })) {
        if (abort.signal.aborted || res.destroyed) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      void error;
      if (!res.destroyed) res.write(`data: ${JSON.stringify({ type: "run.error", message: "Не удалось выполнить запрос. Проверьте настройки модели и навыка." })}\n\n`);
    } finally {
      res.off("close", disconnect);
      res.end();
    }
  });

  return router;
}
