import { describe, expect, it } from "vitest";
import { buildContext } from "./ContextBuilder.js";
import type { StoredMessage } from "./types.js";

function storedMessage(overrides: Partial<StoredMessage>): StoredMessage {
  return {
    id: "m1",
    chatId: "c1",
    role: "user",
    content: "hi",
    provider: null,
    model: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildContext", () => {
  it("puts the system prompt first, then history, then the current message", () => {
    const history = [
      storedMessage({ id: "m1", role: "user", content: "earlier question" }),
      storedMessage({ id: "m2", role: "assistant", content: "earlier answer" }),
    ];

    const result = buildContext({
      systemPrompt: "You are a helpful assistant.",
      history,
      currentMessage: "new question",
    });

    expect(result).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "new question" },
    ]);
  });

  it("omits the system message when systemPrompt is empty", () => {
    const result = buildContext({
      systemPrompt: "",
      history: [],
      currentMessage: "hello",
    });

    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });
});
