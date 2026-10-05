export function contextProgress(budget: { usedTokens: number; contextWindow: number }): { value: number; max: number } {
  return { value: Math.max(0, Math.min(budget.usedTokens, budget.contextWindow)), max: budget.contextWindow };
}

export function contextSummary(budget: { usedTokens: number; contextWindow: number; availableTokens: number; outputReserve: number }): string {
  const tokens = (value: number): string => new Intl.NumberFormat("ru").format(value);
  return `Контекст ≈${tokens(budget.usedTokens)} / ${tokens(budget.contextWindow)} · для ввода ≈${tokens(budget.availableTokens)} · резерв ответа ≈${tokens(budget.outputReserve)}`;
}
