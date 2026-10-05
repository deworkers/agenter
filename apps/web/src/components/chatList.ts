import type { Chat } from "../api/types.js";

export interface ChatGroup {
  label: string;
  chats: Chat[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function localDayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function activityGroup(chat: Chat, today: Date): string {
  const updatedAt = new Date(chat.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return "Ранее";
  const daysAgo = Math.floor((localDayStart(today) - localDayStart(updatedAt)) / DAY_MS);
  if (daysAgo === 0) return "Сегодня";
  if (daysAgo === 1) return "Вчера";
  return "Ранее";
}

export function groupChats(chats: Chat[], query: string, today = new Date()): ChatGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const groups = new Map<string, Chat[]>();

  for (const chat of chats) {
    if (normalizedQuery && !chat.title.toLocaleLowerCase("ru").includes(normalizedQuery)) continue;
    const label = activityGroup(chat, today);
    const group = groups.get(label) ?? [];
    group.push(chat);
    groups.set(label, group);
  }

  return ["Сегодня", "Вчера", "Ранее"]
    .flatMap(label => groups.has(label) ? [{ label, chats: groups.get(label)! }] : []);
}
