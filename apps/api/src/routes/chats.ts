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

  router.delete("/:id", (req, res) => {
    chatService.deleteChat(req.params.id);
    res.status(204).end();
  });

  return router;
}
