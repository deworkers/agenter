import express from "express";
import { expect, it, vi } from "vitest";
import type { ChatService } from "../services/ChatService.js";
import { createChatsRouter } from "./chats.js";

it("renames chats through PATCH with validation and missing-chat handling", async () => {
  const chat = { id: "c1", title: "Новое имя", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:01:00.000Z" };
  const renameChat = vi.fn((id: string, title: string) => id === "c1" ? { ...chat, title } : undefined);
  const service = {
    listChats: () => [], createChat: () => chat, getChatWithMessages: () => undefined,
    renameChat, deleteChat: () => undefined,
  } as unknown as ChatService;
  const app = express();
  app.use(express.json());
  app.use("/api/chats", createChatsRouter(service));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const url = `http://127.0.0.1:${address.port}/api/chats/c1`;
    const patch = (body: unknown) => fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    expect((await patch({ title: "   " })).status).toBe(400);
    expect((await patch({ title: "x".repeat(121) })).status).toBe(400);
    expect((await patch({ title: "  Проект  " })).status).toBe(200);
    expect(renameChat).toHaveBeenCalledWith("c1", "Проект");
    const missing = await fetch(`${url.replace("/c1", "/c404")}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Missing" }) });
    expect(missing.status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
