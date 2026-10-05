export function chatPreferenceKey(userId: string, chatId: string | null): string {
  return `agenter:user:${userId}:chat:${chatId ?? "new"}`;
}
