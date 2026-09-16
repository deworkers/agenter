// apps/api/src/config.ts
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

export interface AppConfig {
  port: number;
  dbPath: string;
  provider: {
    id: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? "3000"),
    dbPath: process.env.DB_PATH ?? "./data/agenter.db",
    provider: {
      id: process.env.PROVIDER_ID ?? "local-fast",
      baseUrl: requireEnv("PROVIDER_BASE_URL"),
      apiKey: process.env.PROVIDER_API_KEY ?? "local",
      model: requireEnv("PROVIDER_MODEL"),
    },
  };
}
