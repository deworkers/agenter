// apps/web/src/api/client.ts
import type { AgentEvent, Chat, StoredMessage, ProvidersResponse, SkillsResponse, McpResponse, NewSkillInput, SkillSummary, SendMessageOptions } from "./types.js";
import type { Settings, RequestContext, CompactResult } from "./types.js";

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
    !value.skills.every((skill: unknown) => {
      if (!isRecord(skill) || typeof skill.id !== "string" || typeof skill.name !== "string" || typeof skill.description !== "string") return false;
      return skill.mcpServers === undefined || (Array.isArray(skill.mcpServers) && skill.mcpServers.every((id: unknown) => typeof id === "string"));
    })) {
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
    case "run.context":
      if (isRecord(value.context) && typeof value.context.systemPrompt === "string" && Array.isArray(value.context.tools) &&
        value.context.tools.every((tool: unknown) => isRecord(tool) && typeof tool.name === "string" && typeof tool.description === "string" && isRecord(tool.inputSchema)) &&
        (value.context.skill === undefined || (isRecord(value.context.skill) && typeof value.context.skill.id === "string" && typeof value.context.skill.content === "string"))) return value as unknown as AgentEvent;
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
    const body: unknown = await response.json().catch(() => undefined);
    throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : `Request failed: ${response.status} ${response.statusText}`);
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

export async function createSkill(input: NewSkillInput): Promise<SkillSummary> {
  const response = await fetch("/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : `Request failed: ${response.status} ${response.statusText}`);
  }
  const created = await response.json() as unknown;
  if (!isRecord(created) || typeof created.id !== "string" || typeof created.name !== "string" || typeof created.description !== "string") {
    throw new Error("Invalid skill response");
  }
  return created as unknown as SkillSummary;
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

export async function compactChat(id: string, options: SendMessageOptions = {}, signal?: AbortSignal): Promise<CompactResult> {
  const value: unknown = await json(await fetch(`/api/chats/${id}/compact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options), ...(signal ? { signal } : {}) }));
  if (!isRecord(value) || typeof value.summary !== "string" || typeof value.provider !== "string" || typeof value.model !== "string" || !Number.isInteger(value.compactedMessages) || typeof value.beforeTokens !== "number" || typeof value.afterTokens !== "number") throw new Error("Некорректный ответ сжатия контекста");
  return value as unknown as CompactResult;
}

export async function deleteChat(id: string): Promise<void> {
  const response = await fetch(`/api/chats/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
}

export async function* sendMessage(chatId: string, content: string, options: SendMessageOptions = {}, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, ...options }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;

  try {
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
      const event = decodeEvent(value);
      if (event.type === "run.completed" || event.type === "run.error") terminal = true;
      yield event;
      if (terminal) return;
    }
  }
  if (!terminal) throw new Error("Ответ прерван до завершения. Можно повторить запрос.");
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export async function getSettings(): Promise<{ settings: Settings; environment: Record<string, boolean> }> {
  return json(await fetch("/api/settings"));
}
export async function saveSettings(settings: Settings): Promise<{ settings: Settings }> {
  return json(await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) }));
}
export async function testConnection(settings: Settings, kind: "model" | "mcp", id: string): Promise<{ ok: boolean; tools?: Array<{ name: string; description: string }> }> {
  return json(await fetch("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings, kind, id }) }));
}
export async function getSkill(id: string): Promise<NewSkillInput> { return json(await fetch(`/api/skills/${encodeURIComponent(id)}`)); }
export async function updateSkill(input: NewSkillInput): Promise<SkillSummary> {
  return json(await fetch(`/api/skills/${encodeURIComponent(input.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
}
export async function removeSkill(id: string): Promise<void> {
  const response = await fetch(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) await json(response);
}
export async function previewContext(chatId: string, content: string, options: SendMessageOptions, signal?: AbortSignal): Promise<{ providerId: string; model: string; context: RequestContext }> {
  return json(await fetch("/api/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, content, ...options }), signal }));
}
