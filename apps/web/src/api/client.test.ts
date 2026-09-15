// apps/web/src/api/client.test.ts
import { describe, expect, it, vi } from "vitest";
import { sendMessage } from "./client.js";

function sseResponse(events: object[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200 });
}

describe("sendMessage", () => {
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

    vi.unstubAllGlobals();
  });
});
