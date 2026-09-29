// apps/api/src/config.ts
import type { RoutingConfig } from "@agenter/agent-core";
import { config as loadEnv } from "dotenv";
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
  maxOutputTokens?: number;
  timeoutMs?: number;
  supportsTools?: boolean;
  label?: string;
}

export interface AppConfig {
  port: number;
  dbPath: string;
  providers: ProviderConfigEntry[];
  defaultProviderId: string;
  routing: RoutingConfig;
}

const ENV_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

export function interpolateEnv(value: string, throwOnMissing = true): string {
  const match = ENV_PLACEHOLDER.exec(value);
  if (!match) return value;

  const varName = match[1] as string;
  const resolved = process.env[varName];
  if (!resolved) {
    if (throwOnMissing) throw new Error(`Missing required environment variable: ${varName}`);
    return value; // leave placeholder unresolved — only used for inactive remote providers
  }
  return resolved;
}
