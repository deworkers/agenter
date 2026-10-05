import { afterEach, describe, expect, it, vi } from "vitest";
import { watch } from "vue";
import { useChats } from "./useChats.js";
import { answerFiles } from "./answerFiles.js";

afterEach(() => vi.unstubAllGlobals());

describe("returning to chat home", () => {
  it("keeps saved chats and does not create or delete a conversation", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const state = useChats();
    const chat = { id: "c", title: "Saved", createdAt: "", updatedAt: "" };
    state.chats.value = [chat]; state.activeChat.value = chat;
    state.messages.value = [{ id: "m", chatId: "c", role: "user", content: "Saved text", provider: null, model: null, createdAt: "" }];
    state.showHome();
    expect(state.activeChat.value).toBeNull();
    expect(state.messages.value).toEqual([]);
    expect(state.chats.value).toEqual([chat]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("can leave a running conversation and stays put during compaction", () => {
    const state = useChats();
    state.activeChat.value = { id: "c", title: "Running", createdAt: "", updatedAt: "" };
    state.isStreaming.value = true;
    state.showHome();
    expect(state.activeChat.value).toBeNull();
    state.activeChat.value = { id: "c", title: "Running", createdAt: "", updatedAt: "" };
    state.isStreaming.value = false; state.isCompacting.value = true;
    state.showHome();
    expect(state.activeChat.value?.id).toBe("c");
  });

  it("ignores a pending history response after returning home", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const state = useChats();
    const pending = state.openChat("c");
    state.showHome();
    resolve(Response.json({ chat: { id: "c", title: "Saved", createdAt: "", updatedAt: "" }, messages: [] }));
    await pending;
    expect(state.activeChat.value).toBeNull();
    expect(state.messages.value).toEqual([]);
  });
});

describe("sending with a selected provider", () => {
  it("keeps the origin chat stream live while another chat is open", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const chats = [
      { id: "a", title: "A", createdAt: "", updatedAt: "" },
      { id: "b", title: "B", createdAt: "", updatedAt: "" },
    ];
    const requests: Array<{ url: string; method?: string }> = [];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method });
      if (url === "/api/chats/a/messages") return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } })));
      const id = url.endsWith("/b") ? "b" : "a";
      return Promise.resolve(Response.json({ chat: chats.find(chat => chat.id === id), messages: [] }));
    });
    vi.stubGlobal("fetch", fetch);
    const state = useChats();
    state.chats.value = chats;
    state.activeChat.value = chats[0]!;
    const pending = state.sendMessage("hello");
    await new Promise(resolve => setTimeout(resolve, 0));
    stream.enqueue(new TextEncoder().encode('data: {"type":"text.delta","text":"Live answer"}\n\n'));
    await new Promise(resolve => setTimeout(resolve, 0));

    await state.openChat("b");
    expect(state.activeChat.value?.id).toBe("b");
    expect(state.messages.value).toEqual([]);
    expect(state.activeRunChatId.value).toBe("a");
    await state.removeChat("a");
    expect(requests.some(request => request.url === "/api/chats/a" && request.method === "DELETE")).toBe(false);
    await state.sendMessage("second prompt");
    expect(fetch.mock.calls.filter(([url]) => url === "/api/chats/a/messages" || url === "/api/chats/b/messages")).toHaveLength(1);

    await state.openChat("a");
    expect(state.messages.value.at(-1)).toMatchObject({ content: "Live answer", runPhase: "receiving" });
    stream.enqueue(new TextEncoder().encode('data: {"type":"run.completed"}\n\n'));
    stream.close();
    await pending;
    expect(state.activeRunChatId.value).toBeNull();
  });

  it("cancels the origin run when Stop is pressed from another chat", async () => {
    const chats = [
      { id: "a", title: "A", createdAt: "", updatedAt: "" },
      { id: "b", title: "B", createdAt: "", updatedAt: "" },
    ];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/chats/a/messages") return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
        },
      })));
      const id = url.endsWith("/b") ? "b" : "a";
      return Promise.resolve(Response.json({ chat: chats.find(chat => chat.id === id), messages: [] }));
    });
    vi.stubGlobal("fetch", fetch);
    const state = useChats();
    state.chats.value = chats;
    state.activeChat.value = chats[0]!;
    const pending = state.sendMessage("hello");
    await new Promise(resolve => setTimeout(resolve, 0));
    const originMessages = state.messages.value;
    await state.openChat("b");
    state.stopGeneration();
    await pending;
    expect(state.activeChat.value?.id).toBe("b");
    expect(state.messages.value).toEqual([]);
    expect(state.activeRunChatId.value).toBeNull();
    expect(originMessages.at(-1)).toMatchObject({ error: "Генерация остановлена.", runPhase: "error" });
  });

  it("applies the final event to the origin while another chat remains open", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const chats = [
      { id: "a", title: "A", createdAt: "", updatedAt: "" },
      { id: "b", title: "B", createdAt: "", updatedAt: "" },
    ];
    vi.stubGlobal("fetch", vi.fn((url: string) => url === "/api/chats/a/messages"
      ? Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } })))
      : Promise.resolve(Response.json({ chat: chats.find(chat => url.endsWith(`/${chat.id}`)), messages: [] }))));
    const state = useChats();
    state.chats.value = chats;
    state.activeChat.value = chats[0]!;
    const pending = state.sendMessage("hello");
    await new Promise(resolve => setTimeout(resolve, 0));
    const originMessages = state.messages.value;
    await state.openChat("b");
    stream.enqueue(new TextEncoder().encode('data: {"type":"text.delta","text":"Final answer"}\n\ndata: {"type":"run.completed"}\n\n'));
    stream.close();
    await pending;
    expect(state.activeChat.value?.id).toBe("b");
    expect(state.messages.value).toEqual([]);
    expect(originMessages.at(-1)).toMatchObject({ content: "Final answer", runPhase: "completed" });
    expect(state.activeRunChatId.value).toBeNull();
  });

  it("sends attachment-only messages and retains documents and requested output format", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('data: {"type":"text.delta","text":"<h1>Done</h1>"}\n\ndata: {"type":"run.completed"}\n\n'));
    vi.stubGlobal("fetch", fetch);
    const attachments = [{ id: "f", name: "notes.md", source: "file" as const, content: "Source" }];
    const state = useChats(); state.activeChat.value = { id: "c", title: "Новый чат", createdAt: "", updatedAt: "" };
    await state.sendMessage("", { attachments, responseFormat: "html" });
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ content: "", attachments, responseFormat: "html" });
    expect(state.messages.value[0]).toMatchObject({ content: "", attachments });
    expect(state.messages.value[1]).toMatchObject({ responseFormat: "html" });
    expect(state.activeChat.value.title).toBe("notes.md");
  });
  it("compacts through a separate endpoint without adding command messages to history", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ summary: "Summary", provider: "local", model: "test", compactedMessages: 2, beforeTokens: 100, afterTokens: 20 }));
    vi.stubGlobal("fetch", fetch);
    const state = useChats(); state.activeChat.value = { id: "c", title: "Existing", createdAt: "", updatedAt: "" };
    state.messages.value = [{ id: "m", chatId: "c", role: "user", content: "Original", provider: null, model: null, createdAt: "" }];
    const result = await state.compact({ providerId: "local", mode: "manual" });
    expect(fetch).toHaveBeenCalledWith("/api/chats/c/compact", expect.objectContaining({ body: JSON.stringify({ providerId: "local", mode: "manual" }) }));
    expect(result?.summary).toBe("Summary"); expect(state.messages.value).toHaveLength(1);
    expect(state.activeChat.value.title).toBe("Existing"); expect(state.isCompacting.value).toBe(false);
  });
  it("lets Stop abort compaction and unlocks the composer", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const state = useChats(); state.activeChat.value = { id: "c", title: "Chat", createdAt: "", updatedAt: "" };
    const pending = state.compact(); state.stopGeneration();
    await expect(pending).rejects.toThrow(); expect(state.isCompacting.value).toBe(false);
  });
  it("aborts the active request when Stop is pressed", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const state = useChats(); state.activeChat.value = { id: "c", title: "Chat", createdAt: "", updatedAt: "" };
    const pending = state.sendMessage("hi"); state.stopGeneration(); await pending;
    expect(state.isStreaming.value).toBe(false);
    expect(state.messages.value.at(-1)?.error).toContain("остановлена");
  });
  it("updates the chat title and stores streamed context under the user message", async () => {
    const context = { systemPrompt: "Base", skill: { id: "review", content: "Review" }, tools: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response([
      'data: {"type":"run.started","provider":"local","model":"qwen"}\n\n',
      `data: ${JSON.stringify({ type: "run.context", context })}\n\n`,
      'data: {"type":"run.completed"}\n\n',
    ].join(""))));
    const state = useChats();
    state.activeChat.value = { id: "c1", title: "Новый чат", createdAt: "", updatedAt: "" };
    state.chats.value = [state.activeChat.value];
    await state.sendMessage("New\nquestion", { mode: "auto", skillId: "review" });
    expect(state.activeChat.value?.title).toBe("New question");
    expect(state.chats.value[0]?.title).toBe("New question");
    expect(Date.parse(state.chats.value[0]!.updatedAt)).toBeGreaterThan(0);
    expect(state.chats.value[0]?.updatedAt).toBe(state.activeChat.value?.updatedAt);
    expect(state.messages.value[0]?.context).toEqual(context);
  });
  it("preserves the first title on later turns and rolls back a failed rename", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('data: {"type":"run.completed"}\n\n'))
      .mockResolvedValueOnce(Response.json({ error: "offline" }, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const state = useChats();
    const chat = { id: "c1", title: "Первый вопрос", createdAt: "", updatedAt: "" };
    state.activeChat.value = chat;
    state.chats.value = [chat];
    state.messages.value = [{ id: "m1", chatId: "c1", role: "user", content: "Первый вопрос", provider: null, model: null, createdAt: "" }];
    await state.sendMessage("Второй вопрос");
    expect(chat.title).toBe("Первый вопрос");
    await expect(state.renameChat("c1", "Новое название")).rejects.toThrow("offline");
    expect(chat.title).toBe("Первый вопрос");
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

  it("replaces a provisional answer when the runtime continues after self-check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response([
      'data: {"type":"run.started","provider":"local","model":"qwen"}\n\n',
      'data: {"type":"run.phase","stage":"waiting"}\n\n',
      'data: {"type":"text.delta","text":"Неполный ответ"}\n\n',
      'data: {"type":"run.phase","stage":"checking"}\n\n',
      'data: {"type":"text.reset"}\n\n',
      'data: {"type":"run.phase","stage":"waiting"}\n\n',
      'data: {"type":"text.delta","text":"Проверенный ответ"}\n\n',
      'data: {"type":"run.phase","stage":"checking"}\n\n',
      'data: {"type":"run.completed"}\n\n',
    ].join(""))));
    const state = useChats();
    state.activeChat.value = { id: "c1", title: "Chat", createdAt: "", updatedAt: "" };

    await state.sendMessage("Проверь", { mode: "auto" });

    expect(state.messages.value.at(-1)).toMatchObject({ content: "Проверенный ответ", runPhase: "completed", provisional: false });
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

  it("rebuilds HTML and Markdown answer files from messages restored from history", async () => {
    const html = '<!doctype html><html><body><h1>Saved</h1></body></html>';
    const markdown = "# Saved guide\n\n```js\nconsole.log('saved')\n```";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      chat: { id: "c1", title: "Files", createdAt: "", updatedAt: "" },
      messages: [
        { id: "html", chatId: "c1", role: "assistant", content: html, provider: "local", model: "qwen", createdAt: "", responseFormat: "html" },
        { id: "markdown", chatId: "c1", role: "assistant", content: markdown, provider: "local", model: "qwen", createdAt: "", responseFormat: "markdown" },
      ],
    })));
    const state = useChats();
    await state.openChat("c1");
    expect(answerFiles(state.messages.value[0]!.content, state.messages.value[0]!.responseFormat)).toEqual([{ name: "answer.html", content: html, format: "html" }]);
    expect(answerFiles(state.messages.value[1]!.content, state.messages.value[1]!.responseFormat)).toEqual([{ name: "answer.md", content: markdown, format: "markdown" }]);
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
