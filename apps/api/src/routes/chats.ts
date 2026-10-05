// apps/api/src/routes/chats.ts
import { Router } from "express";
import type { ChatService } from "../services/ChatService.js";

export function createChatsRouter(chatService: ChatService): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(chatService.listChats());
  });

  router.post("/", (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title : undefined;
    res.status(201).json(chatService.createChat(title));
  });

  router.get("/:id", (req, res) => {
    const result = chatService.getChatWithMessages(req.params.id);
    if (!result) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }
    res.json(result);
  });

  router.patch("/:id", (req, res) => {
    const title = req.body?.title;
    if (typeof title !== "string" || !title.trim() || Array.from(title.trim()).length > 120) {
      res.status(400).json({ error: "Название должно содержать от 1 до 120 символов" });
      return;
    }
    const chat = chatService.renameChat(req.params.id, title.trim());
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }
    res.json(chat);
  });

  router.post("/:id/compact", async (req, res) => {
    if (!chatService.getChatWithMessages(req.params.id)) { res.status(404).json({ error: "Чат не найден" }); return; }
    const { providerId, mode, skillId } = req.body ?? {};
    if ((providerId !== undefined && typeof providerId !== "string") || (skillId !== undefined && typeof skillId !== "string") || (mode !== undefined && mode !== "manual" && mode !== "auto")) { res.status(400).json({ error: "Некорректные параметры сжатия" }); return; }
    const abort = new AbortController();
    const disconnect = () => { if (!res.writableEnded) abort.abort(); };
    res.on("close", disconnect);
    try {
      const result = await chatService.compact(req.params.id, { providerId, mode, skillId, signal: abort.signal });
      if (!res.destroyed) res.json(result);
    } catch {
      if (!res.destroyed) res.status(400).json({ error: "Не удалось создать резюме. Проверьте модель, наличие истории и доступное окно контекста." });
    } finally { res.off("close", disconnect); }
  });

  router.delete("/:id", (req, res) => {
    chatService.deleteChat(req.params.id);
    res.status(204).end();
  });

  return router;
}
