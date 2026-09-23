// apps/api/src/config.ts
import { ALL_TASK_TYPES } from "@agenter/agent-core";
import type { RoutingConfig } from "@agenter/agent-core";
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

interface RawProvidersYaml {
  defaultProvider: string;
  providers: Record<
    string,
    { type: "openai-compatible"; baseUrl: string; apiKey: string; model: string; contextWindow?: number }
  >;
}

export function loadConfigFromFile(
  providersYamlPath: string,
  opts?: { skipRemoteInterpolation?: boolean }
): Pick<AppConfig, "providers" | "defaultProviderId"> {
  const raw = parseYaml(readFileSync(providersYamlPath, "utf-8")) as RawProvidersYaml;

  const defaultProviderId = raw.defaultProvider;
  const skipRemote = opts?.skipRemoteInterpolation ?? false;

  const providers: ProviderConfigEntry[] = Object.entries(raw.providers).map(([id, entry]) => {
    let apiKey: string;
    if (id === defaultProviderId) {
      // Default provider always uses strict interpolation.
      apiKey = interpolateEnv(entry.apiKey);
    } else if (skipRemote) {
      // Non-default providers: leave a missing ${VAR} placeholder unresolved so startup doesn't fail.
      apiKey = interpolateEnv(entry.apiKey, false);
    } else {
      // Strict as before.
      apiKey = interpolateEnv(entry.apiKey);
    }

    return { id, type: entry.type, baseUrl: entry.baseUrl, apiKey, model: entry.model, contextWindow: entry.contextWindow };
  });

  return { providers, defaultProviderId };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Plain YAML parse with a runtime shape check: no env-var interpolation is
// needed here because provider ids are not secrets. The YAML may be malformed
// in ways the type system cannot see (missing `routes`, scalar route entries,
// non-string or empty `provider` values), so each level is validated at runtime
// and reported as a clear config error instead of surfacing as an incidental
// TypeError (e.g. reading `routes` of a null document).
export function loadRoutingConfigFromFile(routingYamlPath: string): RoutingConfig {
  const raw = parseYaml(readFileSync(routingYamlPath, "utf-8")) as { routes?: unknown } | null;

  if (!isPlainObject(raw) || !isPlainObject(raw.routes)) {
    throw new Error('Invalid routing configuration: routing.yaml must define a "routes" mapping');
  }

  const routes = raw.routes;

  for (const taskType of ALL_TASK_TYPES) {
    const entry = routes[taskType];
    if (!entry) {
      throw new Error(`routing.yaml is missing a route for task type "${taskType}"`);
    }
    if (!isPlainObject(entry)) {
      throw new Error(
        `Invalid routing configuration: route for task type "${taskType}" must be an object with a "provider"`
      );
    }
    if (typeof entry.provider !== "string" || entry.provider.trim() === "") {
      throw new Error(
        `Invalid routing configuration: route for task type "${taskType}" must map "provider" to a non-empty string`
      );
    }
  }

  return routes as RoutingConfig;
}

const REQUIRED_FIELDS = ["baseUrl", "apiKey", "model"] as const;

function isUnresolvedPlaceholder(value: string): boolean {
  return ENV_PLACEHOLDER.test(value);
}

// Fail-fast structural validation of the resolved configuration. After skipRemoteInterpolation, non-default
// providers may still carry unresolved ${VAR} placeholders (used for inactive remote endpoints), so only a
// non-default provider's apiKey may remain unresolved; any other unresolved placeholder makes the config
// unusable. This function asserts that a usable AppConfig exists before it is handed to buildProviderRegistry:
// there must be at least one provider, a declared default among them, every provider id must be non-empty,
// every entry's type must be exactly "openai-compatible", and each required field (baseUrl, apiKey, model)
// must be non-empty.
export function validateConfig(
  opts: Pick<AppConfig, "providers" | "defaultProviderId">
): void {
  const { providers, defaultProviderId } = opts;
  const defId = String(defaultProviderId ?? "").trim();

  if (providers.length === 0) {
    throw new Error("Invalid configuration: no providers are configured");
  }
  if (!defId) {
    throw new Error("Invalid configuration: default provider id must not be empty");
  }
  if (!providers.some(p => p.id === defId)) {
    throw new Error(`Invalid configuration: declared default provider "${defaultProviderId}" is not registered among the configured providers`);
  }

  for (const entry of providers) {
    const id = String(entry.id).trim();
    if (!id) {
      throw new Error("Invalid configuration: provider id must not be empty");
    }

    if (entry.type !== "openai-compatible") {
      throw new Error(`Invalid configuration: unsupported provider type "${entry.type}" for "${id}"; only "openai-compatible" is supported`);
    }

    const isDefault = entry.id === defId;

    for (const field of REQUIRED_FIELDS) {
      const rawValue = entry[field]; // string-typed per ProviderConfigEntry, but loaded from .env it may be null/undefined at runtime; guard explicitly before coercing.
      if (rawValue === undefined || rawValue === null || (typeof rawValue === 'string' && rawValue.trim() === '')) {
        throw new Error(`Invalid configuration: ${field} must not be empty`);
      }
      const value = String(rawValue).trim();

      // Only a non-default provider's apiKey may remain unresolved; every other field (and the default
      // provider) must be fully resolved.
      const mustResolveFully = isDefault || field !== "apiKey";
      if (mustResolveFully && isUnresolvedPlaceholder(value)) {
        throw new Error(`Invalid configuration: unresolved "${value}" placeholder is not allowed for ${field} of provider "${id}"`);
      }
    }
  }
}

export function loadConfig(): AppConfig {
  const providersYamlPath = path.resolve(__dirname, "../../../config/providers.yaml");
  const routingYamlPath = path.resolve(__dirname, "../../../config/routing.yaml");
  // Production-relevant behavior: local-only mode must not resolve ${VAR} placeholders on inactive remote
  // providers, so skipRemoteInterpolation is passed to avoid the missing-key crash.
  const { providers, defaultProviderId } = loadConfigFromFile(providersYamlPath, { skipRemoteInterpolation: true });
  const routing = loadRoutingConfigFromFile(routingYamlPath);

  validateConfig({ providers, defaultProviderId });

  return {
    port: Number(process.env.PORT ?? "3000"),
    dbPath: process.env.DB_PATH ?? "./data/agenter.db",
    providers,
    defaultProviderId,
    routing,
  };
}
