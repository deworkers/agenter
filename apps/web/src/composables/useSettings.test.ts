import { afterEach, expect, it, vi } from "vitest";
import { useSettings } from "./useSettings.js";
afterEach(() => vi.unstubAllGlobals());
it("keeps edited settings when validation fails and clears the error on successful retry", async () => {
  const settings = { version: 1, defaultProvider: "local", providers: {}, routes: {}, mcpServers: {} };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ settings, environment: { KEY: true } })).mockResolvedValueOnce(Response.json({ error: "Invalid route" }, { status: 400 })).mockResolvedValueOnce(Response.json({ settings })));
  const state = useSettings(); await state.load();
  expect(state.environment.value).toEqual({ KEY: true });
  expect(await state.save()).toBe(false); expect(state.error.value).toBe("Invalid route");
  expect(state.settings.value).toEqual(settings);
  expect(await state.save()).toBe(true); expect(state.error.value).toBe("");
});
