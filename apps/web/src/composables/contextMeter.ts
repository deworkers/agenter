export function contextProgress(budget: { usedTokens: number; contextWindow: number }): { value: number; max: number } {
  return { value: Math.max(0, Math.min(budget.usedTokens, budget.contextWindow)), max: budget.contextWindow };
}
