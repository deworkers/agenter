// apps/api/src/config.ts
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
