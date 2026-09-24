// apps/web/src/api/client.ts
import type { AgentEvent, Chat, StoredMessage, ProvidersResponse, SkillsResponse, McpResponse, SendMessageOptions } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidCatalog(name: string): never {
  throw new Error(`Invalid ${name} catalog response`);
}

function decodeProviders(value: unknown): ProvidersResponse {
  if (!isRecord(value) || !Array.isArray(value.providers) || typeof value.defaultProviderId !== "string" ||
    !value.providers.every((provider: unknown) => isRecord(provider) && typeof provider.id === "string" && typeof provider.model === "string")) {
    return invalidCatalog("providers");
  }
  return value as unknown as ProvidersResponse;
}

function decodeSkills(value: unknown): SkillsResponse {
  if (!isRecord(value) || !Array.isArray(value.skills) ||
    !value.skills.every((skill: unknown) => isRecord(skill) && typeof skill.id === "string" && typeof skill.name === "string" && typeof skill.description === "string")) {
    return invalidCatalog("skills");
  }
  return value as unknown as SkillsResponse;
}

function decodeMcp(value: unknown): McpResponse {
  if (!isRecord(value) || !Array.isArray(value.servers) || !Array.isArray(value.tools) ||
    !value.servers.every((server: unknown) => isRecord(server) && typeof server.id === "string" && (server.status === "ready" || server.status === "error")) ||
    !value.tools.every((tool: unknown) => isRecord(tool) && typeof tool.name === "string" && typeof tool.description === "string" && isRecord(tool.inputSchema) && isRecord(tool.source) && tool.source.kind === "mcp" && typeof tool.source.serverId === "string")) {
    return invalidCatalog("MCP");
  }
  return value as unknown as McpResponse;
}

function decodeEvent(value: unknown): AgentEvent {
  if (!isRecord(value)) throw new Error("Invalid stream event");
  switch (value.type) {
    case "run.started":
      if (typeof value.provider === "string" && typeof value.model === "string") return value as unknown as AgentEvent;
      break;
    case "text.delta":
      if (typeof value.text === "string") return value as unknown as AgentEvent;
      break;
    case "tool.started":
      if (typeof value.tool === "string" && "arguments" in value) return value as unknown as AgentEvent;
      break;
    case "tool.completed":
      if (typeof value.tool === "string" && "result" in value) return value as unknown as AgentEvent;
      break;
    case "run.completed":
      if (value.usage === undefined || (isRecord(value.usage) && typeof value.usage.promptTokens === "number" && typeof value.usage.completionTokens === "number")) return value as unknown as AgentEvent;
      break;
    case "run.error":
      if (typeof value.message === "string") return value as unknown as AgentEvent;
      break;
  }
  throw new Error("Invalid stream event");
}

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
  return decodeProviders(await json<unknown>(await fetch("/api/providers")));
}

export async function listSkills(): Promise<SkillsResponse> {
  return decodeSkills(await json<unknown>(await fetch("/api/skills")));
}

export async function listMcp(): Promise<McpResponse> {
  return decodeMcp(await json<unknown>(await fetch("/api/mcp")));
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

export async function* sendMessage(chatId: string, content: string, options: SendMessageOptions = {}): AsyncGenerator<AgentEvent> {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, ...options }),
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
      let value: unknown;
      try {
        value = JSON.parse(payload) as unknown;
      } catch {
        throw new Error("Invalid stream event");
      }
      yield decodeEvent(value);
    }
  }
}
