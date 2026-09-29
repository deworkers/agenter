import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore, validateSettings } from "./settings.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const config = () => ({ version: 1, defaultProvider: "local", providers: { local: {
  type: "openai-compatible", baseUrl: "http://localhost:1234/v1", apiKey: "${TEST_MODEL_KEY}", model: "test", contextWindow: 8192, maxOutputTokens: 1024,
} }, routes: Object.fromEntries(["simple", "coding", "reasoning", "research", "vision"].map((key) => [key, { provider: "local" }])), mcpServers: {} });

describe("settings", () => {
  it("initializes one working JSON configuration from its template and backs up atomic saves", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agenter-settings-")); directories.push(dir);
    writeFileSync(path.join(dir, "agenter.example.json"), JSON.stringify(config()));
    const store = new SettingsStore(dir);
    const original = store.read();
    expect(original.providers.local?.apiKey).toBe("${TEST_MODEL_KEY}");
    const next = { ...original, providers: { local: { ...original.providers.local!, model: "changed" } } };
    store.save(next);
    expect(new SettingsStore(dir).read().providers.local?.model).toBe("changed");
    expect(JSON.parse(readFileSync(path.join(dir, "agenter.json.bak"), "utf8"))).toEqual(original);
    expect(JSON.parse(readFileSync(path.join(dir, "agenter.example.json"), "utf8"))).toEqual(original);
    expect(existsSync(path.join(dir, "providers.yaml"))).toBe(false);
  });
  it("does not recreate a working configuration from legacy files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agenter-settings-")); directories.push(dir);
    writeFileSync(path.join(dir, "providers.yaml"), 'defaultProvider: local\nproviders:\n  local:\n    type: openai-compatible\n    baseUrl: http://localhost:1234/v1\n    apiKey: "${TEST_MODEL_KEY}"\n    model: test\n');
    writeFileSync(path.join(dir, "routing.yaml"), "routes:\n" + ["simple", "coding", "reasoning", "research", "vision"].map((key) => `  ${key}:\n    provider: local\n`).join(""));
    expect(() => new SettingsStore(dir).read()).toThrow(/agenter.example.json/);
    expect(existsSync(path.join(dir, "agenter.json"))).toBe(false);
  });
  it("never replaces an existing working JSON with the template, even if it is invalid", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agenter-settings-")); directories.push(dir);
    writeFileSync(path.join(dir, "agenter.example.json"), JSON.stringify(config()));
    writeFileSync(path.join(dir, "agenter.json"), "invalid json");
    expect(() => new SettingsStore(dir).read()).toThrow();
    expect(readFileSync(path.join(dir, "agenter.json"), "utf8")).toBe("invalid json");
  });
  it("rejects invalid routes, plain remote credentials and impossible token budgets", () => {
    const value = config();
    expect(() => validateSettings(value)).not.toThrow();
    expect(() => validateSettings({ ...value, routes: { ...value.routes, simple: { provider: "missing" } } })).toThrow();
    expect(() => validateSettings({ ...value, providers: { local: { ...value.providers.local, baseUrl: "https://example.com/v1", apiKey: "secret" } } })).toThrow();
    expect(() => validateSettings({ ...value, providers: { local: { ...value.providers.local, maxOutputTokens: 8192 } } })).toThrow();
  });
  it("rejects unknown fields instead of persisting accidental credentials", () => {
    const value = config();
    expect(() => validateSettings({ ...value, password: "accidental-secret" })).toThrow();
    expect(() => validateSettings({ ...value, providers: { local: { ...value.providers.local, token: "accidental-secret" } } })).toThrow();
    expect(() => validateSettings({ ...value, routes: { ...value.routes, simple: { provider: "local", token: "accidental-secret" } } })).toThrow();
    expect(() => validateSettings({ ...value, mcpServers: { test: { command: "node", password: "accidental-secret" } } })).toThrow();
  });
});
