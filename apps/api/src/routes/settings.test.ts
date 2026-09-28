import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { SettingsStore, validateSettings } from "../settings.js";
import { createSettingsRouter } from "./settings.js";

it("never returns resolved credentials, rejects invalid saves and rolls back failed application", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "agenter-settings-route-"));
  vi.stubEnv("AGENTER_TEST_SECRET", "sentinel-secret-value");
  const store = new SettingsStore(directory);
  const settings = validateSettings({ version: 1, defaultProvider: "remote", providers: { remote: { type: "openai-compatible", baseUrl: "https://example.com/v1", apiKey: "${AGENTER_TEST_SECRET}", model: "test" } }, routes: Object.fromEntries(["simple", "coding", "reasoning", "research", "vision"].map((task) => [task, { provider: "remote" }])), mcpServers: {} });
  store.save(settings);
  const apply = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("sentinel-secret-value"));
  const app = express(); app.use(express.json()); app.use("/api/settings", createSettingsRouter(store, apply));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error();
    const url = `http://127.0.0.1:${address.port}/api/settings`;
    const response = await (await fetch(url)).text(); expect(response).not.toContain("sentinel-secret-value"); expect(response).toContain('"AGENTER_TEST_SECRET":true');
    const save = (body: unknown) => fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await save({ ...settings, defaultProvider: "missing" })).status).toBe(400); expect(apply).not.toHaveBeenCalled(); expect(store.read()).toEqual(settings);
    const next = { ...settings, providers: { remote: { ...settings.providers.remote!, model: "next" } } };
    expect((await save(next)).status).toBe(200); expect(store.read()).toEqual(next);
    const failed = await save(settings); expect(failed.status).toBe(400); expect(await failed.text()).not.toContain("sentinel-secret-value"); expect(store.read()).toEqual(next);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
});
