import type { ChatMessage, StoredMessage } from "./types.js";

export interface BuildContextInput {
  systemPrompt: string;
  activeSkillContent?: string;
  history: StoredMessage[];
  currentMessage: string;
}

export function buildContext(input: BuildContextInput): ChatMessage[] {
  const messages: ChatMessage[] = [];

  const systemContent = [input.systemPrompt, input.activeSkillContent].filter(Boolean).join("\n\n");
  if (systemContent.length > 0) {
    messages.push({ role: "system", content: systemContent });
  }

  for (const stored of input.history) {
    messages.push({ role: stored.role, content: stored.content });
  }

  messages.push({ role: "user", content: input.currentMessage });

  return messages;
}
