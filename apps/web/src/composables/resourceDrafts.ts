import type { ModelSettings, ServerSettings, Settings } from "../api/types.js";
export type ResourceDraft = { kind: "model"; id: string; entry: ModelSettings } | { kind: "mcp"; id: string; entry: ServerSettings };
function identifier(value: string): string {
  const id = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new Error("ID: латинские буквы, цифры, дефис и подчёркивание");
  return id;
}
function endpoint(value: string): string {
  const text = value.trim();
  let parsed: URL;
  try { parsed = new URL(text); } catch { throw new Error("Укажите корректный HTTP(S) адрес"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Адрес должен использовать HTTP(S) без ключей и параметров");
  return text;
}
export function createModelDraft(input: { id: string; label: string; baseUrl: string; apiKey: string; model: string; contextWindow: number; maxOutputTokens: number }): ResourceDraft {
  const id = identifier(input.id);
  if (!input.model.trim()) throw new Error("Укажите идентификатор модели на сервере");
  const baseUrl = endpoint(input.baseUrl);
  const apiKey = input.apiKey.trim();
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname);
  if (!/^\$\{[A-Z0-9_]+\}$/.test(apiKey) && !(isLocal && ["", "local", "ollama", "lm-studio"].includes(apiKey))) throw new Error("Для ключа укажите ссылку ${ENV_NAME}; локальный сервер допускает local или пустое поле");
  if (!Number.isInteger(input.contextWindow) || input.contextWindow < 128 || input.contextWindow > 10_000_000 || !Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 1_000_000 || input.maxOutputTokens >= input.contextWindow) throw new Error("Лимит ответа должен быть меньше окна контекста");
  return { kind: "model", id, entry: { type: "openai-compatible", label: input.label.trim(), baseUrl, apiKey, model: input.model.trim(), contextWindow: input.contextWindow, maxOutputTokens: input.maxOutputTokens, timeoutMs: 600000, supportsTools: true, enabled: true } };
}
export function createServerDraft(input: { id: string; transport: "stdio" | "sse"; url: string; command: string; argsText: string; envText: string }): ResourceDraft {
  const id = identifier(input.id);
  if (input.transport === "sse") return { kind: "mcp", id, entry: { transport: "sse", url: endpoint(input.url), enabled: true, allowedTools: [] } };
  if (!input.command.trim()) throw new Error("Укажите команду запуска MCP-сервера");
  const env: Record<string, string> = {};
  for (const line of input.envText.split(/\r?\n/).filter(line => line.trim())) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error("Переменные окружения: NAME=value, каждая на отдельной строке");
    if (/KEY|TOKEN|SECRET|PASS/i.test(match[1]!) && !/^\$\{[A-Z0-9_]+\}$/.test(match[2]!.trim())) throw new Error("Для секретов укажите ссылку ${ENV_NAME}");
    env[match[1]!] = match[2]!.trim();
  }
  return { kind: "mcp", id, entry: { transport: "stdio", command: input.command.trim(), args: input.argsText.split(/\r?\n/).map(arg => arg.trim()).filter(Boolean), env, enabled: true, allowedTools: [] } };
}
export function stageResource(settings: Settings, draft: ResourceDraft): void {
  const target = draft.kind === "model" ? settings.providers : settings.mcpServers;
  if (Object.hasOwn(target, draft.id)) throw new Error("Этот ID уже используется");
  if (draft.kind === "model") settings.providers[draft.id] = draft.entry;
  else settings.mcpServers[draft.id] = draft.entry;
}
