import { expect, it } from "vitest";
import { parseChatCommand } from "./chatCommands.js";
import { contextProgress, contextSummary } from "./contextMeter.js";
it("recognizes commands without treating their text as a prompt", () => {
  expect(parseChatCommand("hello")).toBeNull();
  expect(parseChatCommand(" /MODEL api-fast ")).toEqual({ name: "model", argument: "api-fast" });
  expect(parseChatCommand("/model")).toEqual({ name: "model", argument: "" });
  expect(parseChatCommand("/new")).toEqual({ name: "new", argument: "" });
  expect(parseChatCommand("/compact")).toEqual({ name: "compact", argument: "" });
  expect(parseChatCommand("/new extra")).toEqual({ name: "invalid", argument: "/new extra" });
  expect(parseChatCommand("/unknown")).toEqual({ name: "invalid", argument: "/unknown" });
});
it("shows occupied context without counting the reserved output as used", () => {
  expect(contextProgress({ usedTokens: 14, contextWindow: 64000 })).toEqual({ value: 14, max: 64000 });
  expect(contextProgress({ usedTokens: 70000, contextWindow: 64000 })).toEqual({ value: 64000, max: 64000 });
  expect(contextSummary({ usedTokens: 5000, contextWindow: 64000, availableTokens: 58000, outputReserve: 1000 })).toBe("Контекст ≈5 000 / 64 000 · для ввода ≈58 000 · резерв ответа ≈1 000");
});
