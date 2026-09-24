import { afterEach, describe, expect, it, vi } from "vitest";
import { useProviders } from "./useProviders.js";

const catalog = {
  providers: [{ id: "fast", model: "fast-model" }, { id: "code", model: "code-model" }],
  defaultProviderId: "code",
};

afterEach(() => vi.unstubAllGlobals());

describe("provider selection", () => {
  it("loads the API catalog and selects Auto while retaining the configured default", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(catalog)));
    const state = useProviders();
    expect(state.isLoading.value).toBe(true);
    await state.refreshProviders();
    expect(state.providers.value).toEqual(catalog.providers);
    expect(state.defaultProviderId.value).toBe("code");
    expect(state.selectedProviderId.value).toBe("auto");
    expect(state.isLoading.value).toBe(false);
    expect(state.error.value).toBeNull();
  });

  it("preserves a valid selection when refreshing the catalog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json(catalog))));
    const state = useProviders();
    await state.refreshProviders();
    state.selectedProviderId.value = "fast";
    await state.refreshProviders();
    expect(state.selectedProviderId.value).toBe("fast");
  });

  it("exposes a loading error and recovers on retry", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(Response.json(catalog)));
    const state = useProviders();
    await state.refreshProviders();
    expect(state.error.value).toBe("Network unavailable");
    expect(state.selectedProviderId.value).toBe("");
    expect(state.isLoading.value).toBe(false);
    await state.refreshProviders();
    expect(state.error.value).toBeNull();
    expect(state.selectedProviderId.value).toBe("auto");
  });

  it("does not allow sending with an unavailable default", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...catalog, defaultProviderId: "missing" })));
    const state = useProviders();
    await state.refreshProviders();
    expect(state.error.value).toBeTruthy();
    expect(state.selectedProviderId.value).toBe("");
  });

  it("resets a removed provider selection to Auto on refresh", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(catalog))
      .mockResolvedValueOnce(Response.json({ providers: [catalog.providers[1]], defaultProviderId: "code" })));
    const state = useProviders();
    await state.refreshProviders();
    state.selectedProviderId.value = "fast";
    await state.refreshProviders();
    expect(state.selectedProviderId.value).toBe("auto");
  });
});
