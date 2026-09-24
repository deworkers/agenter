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

    expect(provider.supportsTools()).toBe(true);
    expect(provider.supportsVision()).toBe(false);
    expect(provider.getContextWindow()).toBe(32000);
  });

  it("assembles interleaved tool fragments, preserves text and emits calls before done", async () => {
    vi.mocked(fetch).mockResolvedValue(sseResponse([
      JSON.stringify({ choices: [{ delta: { content: "Checking ", tool_calls: [
        { index: 0, id: "call-", function: { name: "look", arguments: '{"query"' } },
        { index: 1, id: "call-2", function: { name: "count", arguments: "{}" } },
      ] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [
        { index: 1, function: { name: "", arguments: "" } },
        { index: 0, id: "1", function: { name: "up", arguments: ':"x"}' } },
      ] } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 9, completion_tokens: 4 } }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      "[DONE]",
    ]));
    const provider = new OpenAICompatibleProvider({ id: "p", baseUrl: "http://localhost", apiKey: "x", model: "m" });
    const events = [];
    for await (const event of provider.chat({ messages: [{ role: "user", content: "hi" }] })) events.push(event);
    expect(events).toEqual([
      { type: "text.delta", text: "Checking " },
      { type: "tool.call", call: { id: "call-1", name: "lookup", arguments: { query: "x" } } },
      { type: "tool.call", call: { id: "call-2", name: "count", arguments: {} } },
      { type: "done", usage: { promptTokens: 19, completionTokens: 9 } },
    ]);
  });

  it("serializes tool definitions and neutral assistant/tool history", async () => {
    vi.mocked(fetch).mockResolvedValue(sseResponse([
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }), "[DONE]",
    ]));
    const provider = new OpenAICompatibleProvider({ id: "p", baseUrl: "http://localhost", apiKey: "x", model: "m" });
    const messages = [
      { role: "assistant" as const, content: null, toolCalls: [{ id: "c1", name: "lookup", arguments: { q: "x" } }] },
      { role: "tool" as const, toolCallId: "c1", name: "lookup", content: "done" },
    ];
    const tools = [{ name: "lookup", description: "find", inputSchema: { type: "object" } }];
    for await (const event of provider.chat({ messages, tools })) { void event; }
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body.messages).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } }] },
      { role: "tool", tool_call_id: "c1", name: "lookup", content: "done" },
    ]);
    expect(body.tools).toEqual([{ type: "function", function: { name: "lookup", description: "find", parameters: { type: "object" } } }]);
  });

  it.each(["not-json", "[]"])("sanitizes malformed/non-object arguments (%s)", async (argumentsText) => {
    vi.mocked(fetch).mockResolvedValue(sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c", function: { name: "lookup", arguments: argumentsText } }] }, finish_reason: "tool_calls" }] }),
    ]));
    const provider = new OpenAICompatibleProvider({ id: "p", baseUrl: "http://localhost", apiKey: "x", model: "m" });
    const events = [];
    for await (const event of provider.chat({ messages: [] })) events.push(event);
    expect(events).toEqual([{ type: "error", message: "Provider returned an invalid tool call" }]);
    expect(JSON.stringify(events)).not.toContain(argumentsText);
  });

  it.each([
    {
      label: "missing id",
      calls: [{ index: 0, function: { name: "lookup", arguments: "{}" } }],
    },
    {
      label: "duplicate id",
      calls: [
        { index: 0, id: "same", function: { name: "first", arguments: "{}" } },
        { index: 1, id: "same", function: { name: "second", arguments: "{}" } },
      ],
    },
    {
      label: "empty name",
      calls: [{ index: 0, id: "call-1", function: { name: "", arguments: "{}" } }],
    },
  ])("rejects a tool call with $label", async ({ calls }) => {
    vi.mocked(fetch).mockResolvedValue(sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: calls }, finish_reason: "tool_calls" }] }),
      "[DONE]",
    ]));
    const provider = new OpenAICompatibleProvider({ id: "p", baseUrl: "http://localhost", apiKey: "x", model: "m" });
    const events = [];
    for await (const event of provider.chat({ messages: [] })) events.push(event);

    expect(events).toEqual([{ type: "error", message: "Provider returned an invalid tool call" }]);
  });

  it("reports a stream that ends without a finish reason", async () => {
    vi.mocked(fetch).mockResolvedValue(sseResponse([
      JSON.stringify({ choices: [{ delta: { content: "partial" } }] }),
      "[DONE]",
    ]));
    const provider = new OpenAICompatibleProvider({ id: "p", baseUrl: "http://localhost", apiKey: "x", model: "m" });
    const events = [];
    for await (const event of provider.chat({ messages: [] })) events.push(event);

    expect(events).toEqual([
      { type: "text.delta", text: "partial" },
      { type: "error", message: "Provider stream ended without a finish reason" },
    ]);
  });

  it("converts malformed SSE JSON into one sanitized error event", async () => {
    const malformedPayload = '{"choices":[{"delta":{"content":"sentinel-secret"}}]';
    vi.mocked(fetch).mockResolvedValue(sseResponse([malformedPayload]));
    const provider = new OpenAICompatibleProvider({ id: "p", baseUrl: "http://localhost", apiKey: "x", model: "m" });
    const events = [];
    for await (const event of provider.chat({ messages: [] })) events.push(event);

    expect(events).toEqual([{ type: "error", message: "Provider returned malformed stream data" }]);
    expect(JSON.stringify(events)).not.toContain("sentinel-secret");
  });
});
