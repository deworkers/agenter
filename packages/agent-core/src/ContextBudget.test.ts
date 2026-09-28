import { describe, expect, it } from "vitest";
import { estimateContext } from "./ContextBudget.js";

describe("context budget", () => {
  it("accounts for instructions, tools, history and results separately and reserves output", () => {
    const budget = estimateContext({ systemPrompt: "Base", activeSkillContent: "Steps", history: [{ role: "user", content: "Past" }], currentMessage: "Next", tools: [{ name: "read", description: "Read", inputSchema: {} }], results: ["Result"], contextWindow: 8192, outputReserve: 1024 });
    expect(budget.usedTokens).toBe(Object.values(budget.breakdown).reduce((a, b) => a + b, 0));
    expect(budget.availableTokens).toBe(8192 - 1024 - budget.usedTokens);
    expect(budget.estimated).toBe(true);
    expect(budget.breakdown.results).toBeGreaterThan(0);
  });
  it("marks an overfull context rather than silently truncating instructions", () => {
    expect(estimateContext({ systemPrompt: "x".repeat(2000), history: [], currentMessage: "hi", contextWindow: 100, outputReserve: 20 }).overLimit).toBe(true);
  });
});
