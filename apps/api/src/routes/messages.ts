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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      for await (const event of chatService.sendMessage(req.params.id, content, { providerId, mode, skillId })) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.write(`data: ${JSON.stringify({ type: "run.error", message })}\n\n`);
    } finally {
      res.end();
    }
  });

  return router;
}
