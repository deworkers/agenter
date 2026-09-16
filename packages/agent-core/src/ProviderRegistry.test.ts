import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./ProviderRegistry.js";
import type { LlmEvent, LlmProvider } from "./types.js";

function fakeProvider(id: string, model: string): LlmProvider {
  return {
    id,
    model,
    supportsTools: () => false,
    supportsVision: () => false,
    getContextWindow: () => 8192,
    async *chat(): AsyncIterable<LlmEvent> {},
  };
}

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider by id", () => {
    const registry = new ProviderRegistry("a");
    const provider = fakeProvider("a", "model-a");
    registry.register(provider);

    expect(registry.get("a")).toBe(provider);
    expect(registry.get("missing")).toBeUndefined();
  });

  it("lists all registered providers", () => {
    const registry = new ProviderRegistry("a");
    const a = fakeProvider("a", "model-a");
    const b = fakeProvider("b", "model-b");
    registry.register(a);
    registry.register(b);

    expect(registry.list()).toEqual([a, b]);
  });

  it("returns the provider matching the configured default id", () => {
    const registry = new ProviderRegistry("b");
    registry.register(fakeProvider("a", "model-a"));
    const b = fakeProvider("b", "model-b");
    registry.register(b);

    expect(registry.getDefault()).toBe(b);
    expect(registry.getDefaultId()).toBe("b");
  });

  it("throws when the default id was never registered", () => {
    const registry = new ProviderRegistry("missing");
    registry.register(fakeProvider("a", "model-a"));

    expect(() => registry.getDefault()).toThrow('Default provider "missing" is not registered');
  });
});
