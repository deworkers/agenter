// apps/web/src/api/client.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSkill, listMcp, listProviders, listSkills, sendMessage } from "./client.js";

function sseResponse(events: object[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

describe("catalogs", () => {
  it("posts a new skill and reports validation errors", async () => {
    const input = { id: "review", name: "Review", description: "Check code", instructions: "Review carefully" };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: "review", name: "Review", description: "Check code" }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ error: "Skill already exists" }, { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    expect(await createSkill(input)).toMatchObject({ id: "review" });
    expect(fetch).toHaveBeenCalledWith("/api/skills", expect.objectContaining({ method: "POST", body: JSON.stringify(input) }));
    await expect(createSkill(input)).rejects.toThrow("Skill already exists");
  });
  it("decodes provider, skill and MCP metadata", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ providers: [{ id: "local", model: "qwen" }], defaultProviderId: "local" }))
      .mockResolvedValueOnce(Response.json({ skills: [{ id: "review", name: "Review", description: "Check code" }] }))
      .mockResolvedValueOnce(Response.json({ servers: [{ id: "files", status: "ready" }], tools: [{
        name: "files__read", description: "Read files", inputSchema: { type: "object" },
        source: { kind: "mcp", serverId: "files" },
      }] }));
    vi.stubGlobal("fetch", fetch);

    expect(await listProviders()).toEqual({ providers: [{ id: "local", model: "qwen" }], defaultProviderId: "local" });
    expect(await listSkills()).toEqual({ skills: [{ id: "review", name: "Review", description: "Check code" }] });
    expect(await listMcp()).toEqual({ servers: [{ id: "files", status: "ready" }], tools: [{
      name: "files__read", description: "Read files", inputSchema: { type: "object" },
      source: { kind: "mcp", serverId: "files" },
    }] });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/providers", "/api/skills", "/api/mcp"]);
  });

  it.each([
    { name: "providers", load: listProviders, body: { providers: "bad", defaultProviderId: "x" } },
    { name: "skills", load: listSkills, body: { skills: [{ id: "x", name: 3, description: "d" }] } },
    { name: "MCP", load: listMcp, body: { servers: [], tools: [{ name: "x", source: { kind: "mcp" } }] } },
  ])("rejects malformed $name catalog", async ({ load, body }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(load()).rejects.toThrow(/Invalid .* catalog/);
  });

  it("reports a failed catalog request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(listSkills()).rejects.toThrow(/Request failed: 503/);
  });
});

describe("sendMessage", () => {
  it("decodes the request context event", async () => {
    const context = { systemPrompt: "Base", skill: { id: "review", content: "Steps" }, tools: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([{ type: "run.context", context }])));
    const events = [];
    for await (const event of sendMessage("chat-1", "hello")) events.push(event);
    expect(events).toEqual([{ type: "run.context", context }]);
  });
  it("parses each SSE data line into an AgentEvent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "run.started", provider: "p", model: "m" },
          { type: "text.delta", text: "hi" },
          { type: "run.completed" },
        ])
      )
    );

    const events = [];
    for await (const event of sendMessage("chat-1", "hello")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "run.started", provider: "p", model: "m" },
      { type: "text.delta", text: "hi" },
      { type: "run.completed" },
    ]);

  });

  it("sends Auto with a skill and parses tool lifecycle events across stream chunks", async () => {
    const payload = [
      { type: "run.started", provider: "local", model: "qwen" },
      { type: "tool.started", tool: "files__read", arguments: { path: "a.txt" } },
      { type: "tool.completed", tool: "files__read", result: { text: "ok" } },
      { type: "text.delta", text: "Done" },
      { type: "run.completed" },
    ];
    const stream = payload.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    const bytes = new TextEncoder().encode(stream);
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 37));
        controller.enqueue(bytes.slice(37, 104));
        controller.enqueue(bytes.slice(104));
        controller.close();
      },
    }));
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);

    const events = [];
    for await (const event of sendMessage("chat-1", "read", { mode: "auto", skillId: "review", mcpServerIds: ["files"] })) events.push(event);

    expect(events).toEqual(payload);
    expect(fetch).toHaveBeenCalledWith("/api/chats/chat-1/messages", expect.objectContaining({
      body: JSON.stringify({ content: "read", mode: "auto", skillId: "review", mcpServerIds: ["files"] }),
    }));
  });

  it("rejects malformed streaming events", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([{ type: "tool.started", tool: 3, arguments: {} }])));
    const collect = async () => {
      for await (const event of sendMessage("chat-1", "read")) void event;
    };
    await expect(collect()).rejects.toThrow(/Invalid stream event/);
  });
});
