export type ChatCommand = { name: "model" | "new" | "compact" | "invalid"; argument: string };
export function parseChatCommand(content: string): ChatCommand | null {
  const text = content.trim();
  if (!text.startsWith("/")) return null;
  const match = /^\/(model|new|compact)(?:\s+([^\r\n]*))?$/i.exec(text);
  if (!match) return { name: "invalid", argument: text };
  const name = match[1]!.toLowerCase() as "model" | "new" | "compact";
  const argument = match[2]?.trim() ?? "";
  if (name !== "model" && argument) return { name: "invalid", argument: text };
  return { name, argument };
}
