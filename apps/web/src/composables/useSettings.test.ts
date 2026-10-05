import { afterEach, expect, it, vi } from "vitest";
import { useSettings } from "./useSettings.js";
import { selectMcpTools } from "./mcpToolSelection.js";
afterEach(() => vi.unstubAllGlobals());
it("saves and restores a per-server tool subset without changing other servers", async () => {
  const settings = { version: 1, defaultProvider: "local", providers: {}, routes: {}, mcpServers: {
    gitlab: { command: "gitlab", safetyProfile: "gitlab-review", allowedTools: ["list_issues", "get_file"] },
    search: { command: "search" },
  } };
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ settings, environment: {} }))
    .mockImplementationOnce(async (_url, options) => Response.json({ settings: JSON.parse(options.body) }));
  vi.stubGlobal("fetch", fetch);
  const state = useSettings();
  await state.load();
  state.settings.value!.mcpServers.gitlab!.allowedTools = selectMcpTools(
    [{ name: "list_issues", description: "" }, { name: "get_file", description: "" }],
    state.settings.value!.mcpServers.gitlab!.allowedTools, ["get_file"], false,
  );
  expect(await state.save()).toBe(true);
  const saved = JSON.parse(fetch.mock.calls[1]![1].body);
  expect(saved.mcpServers.gitlab.allowedTools).toEqual(["list_issues"]);
  expect(saved.mcpServers.gitlab.safetyProfile).toBe("gitlab-review");
  expect(saved.mcpServers.search).toEqual({ command: "search" });
  fetch.mockResolvedValueOnce(Response.json({ settings: saved, environment: {} }));
  const restored = useSettings();
  await restored.load();
  expect(restored.settings.value?.mcpServers.gitlab?.allowedTools).toEqual(["list_issues"]);
});
it("keeps edited settings when validation fails and clears the error on successful retry", async () => {
  const settings = { version: 1, defaultProvider: "local", providers: {}, routes: {}, mcpServers: {} };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ settings, environment: { KEY: true } })).mockResolvedValueOnce(Response.json({ error: "Invalid route" }, { status: 400 })).mockResolvedValueOnce(Response.json({ settings })));
  const state = useSettings(); await state.load();
  expect(state.environment.value).toEqual({ KEY: true });
  expect(await state.save()).toBe(false); expect(state.error.value).toBe("Invalid route");
  expect(state.settings.value).toEqual(settings);
  expect(await state.save()).toBe(true); expect(state.error.value).toBe("");
});
