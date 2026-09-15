import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider.js";

function sseResponse(lines: string[]): Response {
  const body = lines.map((line) => `data: ${line}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("OpenAICompatibleProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yields text.delta for each streamed content chunk, then done with usage", async () => {
    const chunks = [
      JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
      JSON.stringify({ choices: [{ delta: { content: "lo!" } }] }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      }),
      "[DONE]",
    ];
    vi.mocked(fetch).mockResolvedValue(sseResponse(chunks));

    const provider = new OpenAICompatibleProvider({
      id: "local-fast",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "local",
      model: "qwen3",
    });

    const events = [];
    for await (const event of provider.chat({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo!" },
      { type: "done", usage: { promptTokens: 8, completionTokens: 3 } },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:1234/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer local",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("yields an error event when the HTTP response is not ok", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );

    const provider = new OpenAICompatibleProvider({
      id: "local-fast",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "wrong-key",
      model: "qwen3",
    });

    const events = [];
    for await (const event of provider.chat({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error", message: "Provider request failed: 401 Unauthorized" }]);
  });

  it("yields an error event when fetch rejects (network error)", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const provider = new OpenAICompatibleProvider({
      id: "local-fast",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "local",
      model: "qwen3",
    });

    const events = [];
    for await (const event of provider.chat({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error", message: "ECONNREFUSED" }]);
  });

  it("reports capabilities and context window from config", () => {
    const provider = new OpenAICompatibleProvider({
      id: "local-fast",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "local",
      model: "qwen3",
      contextWindow: 32000,
    });

    expect(provider.supportsTools()).toBe(false);
    expect(provider.supportsVision()).toBe(false);
    expect(provider.getContextWindow()).toBe(32000);
  });
});
