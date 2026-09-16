import { describe, expect, it } from "vitest";
import type { ProviderConfigEntry } from "./config.js";
import { buildProviderRegistry } from "./providerFactory.js";

const providers: ProviderConfigEntry[] = [
  { id: "fast", type: "openai-compatible", baseUrl: "http://localhost:1234/v1", apiKey: "local", model: "fast-model" },
  { id: "code", type: "openai-compatible", baseUrl: "http://localhost:1234/v1", apiKey: "local", model: "code-model", contextWindow: 16384 },
];

describe("buildProviderRegistry", () => {
  it("registers every configured provider", () => {
    const registry = buildProviderRegistry({ providers, defaultProviderId: "fast" });
    expect(registry.list().map((p) => p.id)).toEqual(["fast", "code"]);
  });

  it("preserves model and context window for the selected provider", () => {
    const registry = buildProviderRegistry({ providers, defaultProviderId: "fast" });
    expect(registry.get("code")?.model).toBe("code-model");
    expect(registry.get("code")?.getContextWindow()).toBe(16384);
  });

  it("uses the configured default instead of the first entry", () => {
    const registry = buildProviderRegistry({ providers, defaultProviderId: "code" });
    expect(registry.getDefault()?.id).toBe("code");
  });

  it("rejects an unregistered default before serving requests", () => {
    expect(() => buildProviderRegistry({ providers, defaultProviderId: "missing" }))
      .toThrow('Default provider "missing" is not registered');
  });
});
