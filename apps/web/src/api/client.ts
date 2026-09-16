// apps/web/src/api/client.ts
import type { AgentEvent, Chat, StoredMessage, ProvidersResponse } from "./types.js";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function listChats(): Promise<Chat[]> {
  return json(await fetch("/api/chats"));
}

export async function listProviders(): Promise<ProvidersResponse> {
  return json(await fetch("/api/providers"));
}

export async function createChat(title?: string): Promise<Chat> {
  return json(
    await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
  );
}

export async function getChat(id: string): Promise<{ chat: Chat; messages: StoredMessage[] }> {
  return json(await fetch(`/api/chats/${id}`));
}

export async function deleteChat(id: string): Promise<void> {
  const response = await fetch(`/api/chats/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
}

export async function* sendMessage(chatId: string, content: string, providerId?: string): AsyncGenerator<AgentEvent> {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, providerId }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice("data: ".length).trim();
      if (payload.length === 0) continue;
      yield JSON.parse(payload) as AgentEvent;
    }
  }
}
