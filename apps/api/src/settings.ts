import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ALL_TASK_TYPES, DEFAULT_SYSTEM_PROMPT, type RoutingConfig } from "@agenter/agent-core";
import type { McpServerConfig } from "@agenter/mcp";
import type { AppConfig, ProviderConfigEntry } from "./config.js";
import { interpolateEnv } from "./config.js";

export interface ModelSettings {
  type: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  label?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  supportsTools?: boolean;
  enabled?: boolean;
}
export type ServerSettings = McpServerConfig & { enabled?: boolean; allowedTools?: string[] };
export interface Settings {
  version: 1;
  systemPrompt: string;
  defaultProvider: string;
  providers: Record<string, ModelSettings>;
  routes: RoutingConfig;
  mcpServers: Record<string, ServerSettings>;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const reference = /^\$\{[A-Z0-9_]+\}$/;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
function fail(message: string): never { throw new RangeError(message); }
function integer(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("Конфигурация содержит неизвестные поля");
}
function url(value: unknown): URL {
  if (typeof value !== "string") return fail("Укажите HTTP(S) адрес подключения");
  let parsed: URL;
  try { parsed = new URL(value); } catch { return fail("Некорректный адрес подключения"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) fail("Адрес должен использовать HTTP(S) без ключей, пароля и параметров");
  return parsed;
}
export function validateSettings(value: unknown): Settings {
  if (!object(value) || value.version !== 1 || !object(value.providers) || !object(value.routes) || !object(value.mcpServers)) fail("Ожидается конфигурация версии 1 с providers, routes и mcpServers");
  fields(value, ["version", "systemPrompt", "defaultProvider", "providers", "routes", "mcpServers"]);
  if (value.systemPrompt !== undefined && (typeof value.systemPrompt !== "string" || value.systemPrompt.length > 100_000)) fail("Базовая инструкция должна быть текстом не длиннее 100000 символов");
  fields(value.routes, ALL_TASK_TYPES);
  const defaultEntry = typeof value.defaultProvider === "string" ? value.providers[value.defaultProvider] : undefined;
  if (!object(defaultEntry) || defaultEntry.enabled === false) fail("Выберите включённую модель по умолчанию");
  for (const [id, entry] of Object.entries(value.providers)) {
    if (!identifier.test(id) || !object(entry) || entry.type !== "openai-compatible" || typeof entry.model !== "string" || !entry.model.trim() || entry.model.length > 1000) fail("Некорректная модель или её ID");
    fields(entry, ["type", "baseUrl", "apiKey", "model", "label", "contextWindow", "maxOutputTokens", "timeoutMs", "supportsTools", "enabled"]);
    const endpoint = url(entry.baseUrl);
    if (typeof entry.apiKey !== "string" || (!reference.test(entry.apiKey) && !(["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) && ["", "local", "ollama", "lm-studio"].includes(entry.apiKey)))) fail("Для ключа используйте ссылку ${ENV_NAME}; локальная модель допускает пустой ключ или local");
    if (entry.label !== undefined && (typeof entry.label !== "string" || entry.label.length > 120)) fail("Название модели слишком длинное");
    for (const field of ["enabled", "supportsTools"]) if (entry[field] !== undefined && typeof entry[field] !== "boolean") fail("Некорректный переключатель модели");
    const window = entry.contextWindow ?? 8192;
    const reserve = entry.maxOutputTokens ?? 1024;
    if (!integer(window, 128, 10_000_000) || !integer(reserve, 1, 1_000_000) || (reserve as number) >= (window as number)) fail("Лимит ответа должен быть меньше окна контекста");
    if (entry.timeoutMs !== undefined && !integer(entry.timeoutMs, 1000, 3_600_000)) fail("Таймаут: от 1000 до 3600000 мс");
  }
  for (const task of ALL_TASK_TYPES) {
    const route = value.routes[task];
    const target = object(route) && typeof route.provider === "string" ? value.providers[route.provider] : undefined;
    if (!object(target) || target.enabled === false) fail(`Маршрут ${task} должен ссылаться на включённую модель`);
    fields(route as Record<string, unknown>, ["provider"]);
  }
  for (const [id, server] of Object.entries(value.mcpServers)) {
    if (!identifier.test(id) || !object(server)) fail("Некорректный ID MCP-сервера");
    fields(server, server.transport === "sse" ? ["transport", "url", "enabled", "allowedTools", "safetyProfile"] : ["transport", "command", "args", "env", "enabled", "allowedTools", "safetyProfile"]);
    if (server.safetyProfile !== undefined && server.safetyProfile !== "gitlab-review") fail("Неизвестный профиль безопасности MCP");
    if (server.enabled !== undefined && typeof server.enabled !== "boolean") fail("Некорректный переключатель MCP");
    if (server.allowedTools !== undefined && (!Array.isArray(server.allowedTools) || !server.allowedTools.every((item) => typeof item === "string" && item.length > 0 && item.length <= 200))) fail("allowedTools должен быть списком имён инструментов");
    if (server.transport === "sse") {
      url(server.url);
      if (server.command !== undefined || server.args !== undefined || server.env !== undefined) fail("Для SSE укажите только URL");
    } else {
      if ((server.transport !== undefined && server.transport !== "stdio") || typeof server.command !== "string" || !server.command.trim()) fail("Для stdio укажите команду запуска");
      if (server.args !== undefined && (!Array.isArray(server.args) || !server.args.every((arg) => typeof arg === "string"))) fail("Аргументы MCP должны быть строками");
      if (server.env !== undefined && (!object(server.env) || !Object.entries(server.env).every(([key, val]) => typeof val === "string" && (!/KEY|TOKEN|SECRET|PASS/i.test(key) || reference.test(val))))) fail("Секретные переменные MCP должны ссылаться на ${ENV_NAME}");
    }
  }
  if (JSON.stringify(value).length > 1_000_000) fail("Конфигурация слишком большая");
  return { ...value, systemPrompt: value.systemPrompt ?? DEFAULT_SYSTEM_PROMPT } as Settings;
}

export class SettingsStore {
  readonly filePath: string;
  constructor(private readonly directory: string) { this.filePath = path.join(directory, "agenter.json"); }
  read(): Settings {
    // A template seeds new installs only; never overwrite a user's working config.
    if (existsSync(this.filePath)) return validateSettings(JSON.parse(readFileSync(this.filePath, "utf8")));
    const templatePath = path.join(this.directory, "agenter.example.json");
    if (!existsSync(templatePath)) throw new Error("Не найден config/agenter.json или шаблон config/agenter.example.json");
    const settings = validateSettings(JSON.parse(readFileSync(templatePath, "utf8")));
    this.save(settings);
    return settings;
  }
  save(input: unknown, backup = true): Settings {
    const settings = validateSettings(input);
    mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    if (backup && existsSync(this.filePath)) copyFileSync(this.filePath, `${this.filePath}.bak`);
    renameSync(temporary, this.filePath);
    return settings;
  }
}

export function resolveSettings(settings: Settings): Pick<AppConfig, "providers" | "defaultProviderId" | "routing"> {
  const providers: ProviderConfigEntry[] = Object.entries(settings.providers)
    .filter(([, entry]) => entry.enabled !== false)
    .map(([id, entry]) => ({ ...entry, id, apiKey: interpolateEnv(entry.apiKey, id === settings.defaultProvider) }));
  return { providers, defaultProviderId: settings.defaultProvider, routing: settings.routes };
}
export function resolveServers(settings: Settings): Record<string, McpServerConfig> {
  return Object.fromEntries(Object.entries(settings.mcpServers).filter(([, entry]) => entry.enabled !== false).map(([id, entry]) => [id, entry.transport === "sse" ? entry : {
    ...entry, args: entry.args?.map((arg) => interpolateEnv(arg)),
    env: entry.env ? Object.fromEntries(Object.entries(entry.env).map(([key, val]) => [key, interpolateEnv(val)])) : undefined,
  }]));
}
