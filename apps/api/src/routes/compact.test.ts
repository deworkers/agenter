import express from "express";
import { expect, it, vi } from "vitest";
import type { ChatService } from "../services/ChatService.js";
import { createChatsRouter } from "./chats.js";
it("compacts only existing chats, validates options and returns safe errors", async () => {
  const compact = vi.fn().mockResolvedValueOnce({ summary: "Summary", provider: "local", model: "test", compactedMessages: 2, beforeTokens: 100, afterTokens: 20 }).mockRejectedValueOnce(new Error("sentinel-secret"));
  const service = { getChatWithMessages: (id: string) => id === "c" ? { chat: { id }, messages: [] } : undefined, compact } as unknown as ChatService;
  const app = express(); app.use(express.json()); app.use("/api/chats", createChatsRouter(service));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error();
    const call = (id: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}/api/chats/${id}/compact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await call("missing", {})).status).toBe(404);
    expect((await call("c", { mode: "invalid" })).status).toBe(400);
    expect(compact).not.toHaveBeenCalled();
    const response = await call("c", { providerId: "local", mode: "manual" });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ summary: "Summary" });
    expect(compact).toHaveBeenCalledWith("c", expect.objectContaining({ providerId: "local", mode: "manual", signal: expect.any(AbortSignal) }));
    const failure = await call("c", {}); expect(failure.status).toBe(400); expect(await failure.text()).not.toContain("sentinel-secret");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
