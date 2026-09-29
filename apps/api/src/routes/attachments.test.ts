import express from "express";
import { expect, it, vi } from "vitest";
import type { ChatService } from "../services/ChatService.js";
import { createMessagesRouter } from "./messages.js";
import { createContextRouter } from "./settings.js";

it("validates attachments before SSE and forwards documents equally to send and context preview", async () => {
  const service = { sendMessage: vi.fn(async function* () { yield { type: "run.completed" }; }), preview: vi.fn(() => ({ context: {} })) } as unknown as ChatService;
  const app = express(); app.use(express.json({ limit: "4mb" }));
  app.use("/api/chats", createMessagesRouter(service)); app.use("/api/context", createContextRouter(service));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error();
    const post = (endpoint: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const attachments = [{ id: "f", name: "notes.md", source: "file", content: "Text" }];
    const valid = await post("/api/chats/c/messages", { content: "", attachments, responseFormat: "html" });
    expect(valid.status).toBe(200); await valid.text();
    expect(service.sendMessage).toHaveBeenCalledWith("c", "", expect.objectContaining({ attachments, responseFormat: "html" }));
    for (const endpoint of ["/api/chats/c/messages", "/api/context"]) {
      for (const body of [{ attachments: "bad" }, { attachments: [{ ...attachments[0], content: "\u0000" }] }, { responseFormat: "pdf" }]) {
        const response = await post(endpoint, { content: "Read", ...body });
        expect(response.status).toBe(400); expect(response.headers.get("content-type")).toContain("application/json");
      }
    }
    expect((await post("/api/context", { chatId: "c", content: "", attachments, responseFormat: "markdown" })).status).toBe(200);
    expect(service.preview).toHaveBeenCalledWith("c", "", expect.objectContaining({ attachments, responseFormat: "markdown" }));
    expect((await post("/api/chats/c/messages", { content: "" })).status).toBe(400);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
