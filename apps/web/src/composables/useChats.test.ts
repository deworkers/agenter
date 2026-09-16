import { afterEach, describe, expect, it, vi } from "vitest";
import { useChats } from "./useChats.js";

afterEach(() => vi.unstubAllGlobals());

describe("sending with a selected provider", () => {
  it("sends the selected provider to the API and labels the reply from run.started", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response([
      'data: {"type":"run.started","provider":"code","model":"code-model"}\n\n',
      'data: {"type":"text.delta","text":"Hello"}\n\n',
      'data: {"type":"run.completed"}\n\n',
    ].join("")));
    vi.stubGlobal("fetch", fetch);
    const state = useChats();
    state.activeChat.value = { id: "c1", title: "Chat", createdAt: "", updatedAt: "" };
    await state.sendMessage("hi", "code");
    expect(fetch).toHaveBeenCalledWith("/api/chats/c1/messages", expect.objectContaining({
      body: JSON.stringify({ content: "hi", providerId: "code" }),
    }));
    expect(state.messages.value.at(-1)).toMatchObject({ content: "Hello", provider: "code", model: "code-model" });
    expect(state.isStreaming.value).toBe(false);
  });

  it("reports a transport error and unlocks the composer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network unavailable")));
    const state = useChats();
    state.activeChat.value = { id: "c1", title: "Chat", createdAt: "", updatedAt: "" };
    await state.sendMessage("hi", "code");
    expect(state.messages.value.at(-1)?.content).toContain("Network unavailable");
    expect(state.isStreaming.value).toBe(false);
  });
});
