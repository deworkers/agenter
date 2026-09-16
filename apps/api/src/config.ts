// apps/api/src/config.ts
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

export interface ProviderConfigEntry {
  id: string;
  type: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow?: number;
}

export interface AppConfig {
  port: number;
  dbPath: string;
  providers: ProviderConfigEntry[];
  defaultProviderId: string;
}

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

export function interpolateEnv(value: string): string {
  const match = ENV_PLACEHOLDER.exec(value);
  if (!match) return value;

  const varName = match[1] as string;
  const resolved = process.env[varName];
  if (!resolved) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
  return resolved;
}

interface RawProvidersYaml {
  defaultProvider: string;
  providers: Record<
    string,
    { type: "openai-compatible"; baseUrl: string; apiKey: string; model: string; contextWindow?: number }
  >;
}

export function loadConfigFromFile(providersYamlPath: string): Pick<AppConfig, "providers" | "defaultProviderId"> {
  const raw = parseYaml(readFileSync(providersYamlPath, "utf-8")) as RawProvidersYaml;

  const providers: ProviderConfigEntry[] = Object.entries(raw.providers).map(([id, entry]) => ({
    id,
    type: entry.type,
    baseUrl: entry.baseUrl,
    apiKey: interpolateEnv(entry.apiKey),
    model: entry.model,
    contextWindow: entry.contextWindow,
  }));

  return { providers, defaultProviderId: raw.defaultProvider };
}

export function loadConfig(): AppConfig {
  const configPath = path.resolve(__dirname, "../../../config/providers.yaml");
  const { providers, defaultProviderId } = loadConfigFromFile(configPath);

  return {
    port: Number(process.env.PORT ?? "3000"),
    dbPath: process.env.DB_PATH ?? "./data/agenter.db",
    providers,
    defaultProviderId,
  };
}
