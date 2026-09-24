import { afterEach, describe, expect, it, vi } from "vitest";
import { watch } from "vue";
import { useChats } from "./useChats.js";

afterEach(() => vi.unstubAllGlobals());

describe("sending with a selected provider", () => {
  it("updates the chat title and stores streamed context under the user message", async () => {
    const context = { systemPrompt: "Base", skill: { id: "review", content: "Review" }, tools: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response([
      'data: {"type":"run.started","provider":"local","model":"qwen"}\n\n',
      `data: ${JSON.stringify({ type: "run.context", context })}\n\n`,
      'data: {"type":"run.completed"}\n\n',
    ].join(""))));
    const state = useChats();
    state.activeChat.value = { id: "c1", title: "Old", createdAt: "", updatedAt: "" };
    state.chats.value = [state.activeChat.value];
    await state.sendMessage("New\nquestion", { mode: "auto", skillId: "review" });
    expect(state.activeChat.value?.title).toBe("New question");
    expect(state.chats.value[0]?.title).toBe("New question");
    expect(state.messages.value[0]?.context).toEqual(context);
  });
  it("sends the selected provider to the API and labels the reply from run.started", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response([
      'data: {"type":"run.started","provider":"code","model":"code-model"}\n\n',
      'data: {"type":"text.delta","text":"Hello"}\n\n',
      'data: {"type":"run.completed"}\n\n',
    ].join("")));
    vi.stubGlobal("fetch", fetch);
    const state = useChats();
    state.activeChat.value = { id: "c1", title: "Chat", createdAt: "", updatedAt: "" };
    await state.sendMessage("hi", { providerId: "code", mode: "manual" });
    expect(fetch).toHaveBeenCalledWith("/api/chats/c1/messages", expect.objectContaining({
      body: JSON.stringify({ content: "hi", providerId: "code", mode: "manual" }),
    }));
    expect(state.messages.value.at(-1)).toMatchObject({ content: "Hello", provider: "code", model: "code-model" });
    expect(state.isStreaming.value).toBe(false);
  });

  it("reports a transport error and unlocks the composer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network unavailable")));
    const state = useChats();
    state.activeChat.value = { id: "c1", title: "Chat", createdAt: "", updatedAt: "" };
    await state.sendMessage("hi", { providerId: "code", mode: "manual" });
    expect(state.messages.value.at(-1)?.error).toContain("Network unavailable");
    expect(state.isStreaming.value).toBe(false);
  });

  it("streams tool activity, Auto and skill selection, then keeps final text and duration", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response([
      'data: {"type":"run.started","provider":"local","model":"qwen"}\n\n',
      'data: {"type":"tool.started","tool":"files__read","arguments":{"path":"a.txt"}}\n\n',
      'data: {"type":"tool.completed","tool":"files__read","result":{"text":"ok"}}\n\n',
      'data: {"type":"text.delta","text":"Found it"}\n\n',
      'data: {"type":"run.completed"}\n\n',
    ].join("")));
    vi.stubGlobal("fetch", fetch);
    const state = useChats();
    state.activeChat.value = { id: "c1", title: "Chat", createdAt: "", updatedAt: "" };

    await state.sendMessage("read", { mode: "auto", skillId: "review" });

    expect(fetch).toHaveBeenCalledWith("/api/chats/c1/messages", expect.objectContaining({
      body: JSON.stringify({ content: "read", mode: "auto", skillId: "review" }),
    }));
    expect(state.messages.value.at(-1)).toMatchObject({
      content: "Found it", provider: "local", model: "qwen",
      tools: [{ name: "files__read", arguments: { path: "a.txt" }, result: { text: "ok" }, status: "completed" }],
    });
    expect(state.messages.value.at(-1)?.durationMs).toEqual(expect.any(Number));
  });

  it("marks an unfinished tool as failed and preserves partial assistant text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response([
      'data: {"type":"run.started","provider":"local","model":"qwen"}\n\n',
      'data: {"type":"text.delta","text":"Checking..."}\n\n',
      'data: {"type":"tool.started","tool":"files__read","arguments":{}}\n\n',
      'data: {"type":"run.error","message":"Tool execution failed."}\n\n',
    ].join(""))));
    const state = useChats();
    state.activeChat.value = { id: "c1", title: "Chat", createdAt: "", updatedAt: "" };

    await state.sendMessage("read", { mode: "auto" });

    expect(state.messages.value.at(-1)).toMatchObject({
      content: "Checking...", error: "Tool execution failed.",
      tools: [{ name: "files__read", status: "error" }],
    });
  });

  it("restores saved provider and model when a chat is reopened", async () => {
    const context = { systemPrompt: "Base", skill: { id: "review", content: "Review" }, tools: [] };
    const user = { id: "m0", chatId: "c1", role: "user", content: "Question", provider: null, model: null, createdAt: "2026-09-24T00:00:00Z", context };
    const stored = { id: "m1", chatId: "c1", role: "assistant", content: "Saved", provider: "local", model: "qwen", createdAt: "2026-09-24T00:00:00Z" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      chat: { id: "c1", title: "Question", createdAt: "", updatedAt: "" }, messages: [user, stored],
    })));
    const state = useChats();
    await state.openChat("c1");
    expect(state.messages.value).toMatchObject([{ content: "Question", context }, { content: "Saved", provider: "local", model: "qwen" }]);
  });

  it("reactively exposes text deltas before the stream completes", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
    }))));
    const state = useChats();
    state.activeChat.value = { id: "c1", title: "Chat", createdAt: "", updatedAt: "" };
    const observed: Array<string | undefined> = [];
    const stop = watch(() => state.messages.value.at(-1)?.content, (value) => observed.push(value), { flush: "sync" });

    const pending = state.sendMessage("hi", { mode: "auto" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.enqueue(new TextEncoder().encode('data: {"type":"run.started","provider":"p","model":"m"}\n\ndata: {"type":"text.delta","text":"Hel"}\n\n'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observed).toContain("Hel");
    controller.enqueue(new TextEncoder().encode('data: {"type":"text.delta","text":"lo"}\n\ndata: {"type":"run.completed"}\n\n'));
    controller.close();
    await pending;
    stop();
    expect(state.messages.value.at(-1)?.content).toBe("Hello");
  });
});
