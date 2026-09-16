import { ProviderRegistry } from "@agenter/agent-core";
import { OpenAICompatibleProvider } from "@agenter/provider-openai-compatible";
import type { AppConfig } from "./config.js";

export function buildProviderRegistry(config: Pick<AppConfig, "providers" | "defaultProviderId">): ProviderRegistry {
  const registry = new ProviderRegistry(config.defaultProviderId);

  for (const entry of config.providers) {
    const provider = new OpenAICompatibleProvider({
      id: entry.id,
      baseUrl: entry.baseUrl,
      apiKey: entry.apiKey,
      model: entry.model,
      contextWindow: entry.contextWindow,
    });
    registry.register(provider);
  }

  registry.getDefault();
  return registry;
}

