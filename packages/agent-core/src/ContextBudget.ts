import type { ChatMessage, ContextBudget, ToolDefinition } from "./types.js";

export interface ContextBudgetInput {
  systemPrompt: string;
  activeSkillContent?: string;
  history: ChatMessage[];
  currentMessage: string;
  tools?: ToolDefinition[];
  results?: string[];
  contextWindow: number;
  outputReserve: number;
}
// Conservative approximation for mixed Russian/Latin text. Provider tokenizer
// and wire-format overhead differ, so this must never be labelled exact usage.
export function estimateTokens(text: string): number { return text.length ? Math.ceil(new TextEncoder().encode(text).length / 3) + 4 : 0; }
export function estimateContext(input: ContextBudgetInput): ContextBudget {
  const breakdown = {
    system: estimateTokens(input.systemPrompt), skill: estimateTokens(input.activeSkillContent ?? ""),
    tools: input.tools?.length ? estimateTokens(JSON.stringify(input.tools)) : 0,
    history: input.history.reduce((sum, item) => sum + estimateTokens(item.content), 0),
    message: estimateTokens(input.currentMessage), results: (input.results ?? []).reduce((sum, result) => sum + estimateTokens(result), 0),
  };
  const usedTokens = Object.values(breakdown).reduce((sum, val) => sum + val, 0);
  return { contextWindow: input.contextWindow, outputReserve: input.outputReserve, usedTokens, availableTokens: Math.max(0, input.contextWindow - input.outputReserve - usedTokens), estimated: true, overLimit: usedTokens + input.outputReserve > input.contextWindow, breakdown };
}
