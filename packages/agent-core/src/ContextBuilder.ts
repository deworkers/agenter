import type { ChatMessage, StoredMessage } from "./types.js";

export interface BuildContextInput {
  systemPrompt: string;
  history: StoredMessage[];
  currentMessage: string;
}

export function buildContext(input: BuildContextInput): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (input.systemPrompt.length > 0) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  for (const stored of input.history) {
    messages.push({ role: stored.role, content: stored.content });
  }

  messages.push({ role: "user", content: input.currentMessage });

  return messages;
}
