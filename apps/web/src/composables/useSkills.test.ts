import { afterEach, describe, expect, it, vi } from "vitest";
import { useSkills } from "./useSkills.js";

const catalog = { skills: [
  { id: "review", name: "Code review", description: "Review code" },
  { id: "research", name: "Research", description: "Find sources" },
] };

afterEach(() => vi.unstubAllGlobals());

describe("skill selection", () => {
  it("loads metadata with None selected and preserves a valid manual choice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json(catalog))));
    const state = useSkills();
    expect(state.isLoading.value).toBe(true);
    await state.refreshSkills();
    expect(state.skills.value).toEqual(catalog.skills);
    expect(state.selectedSkillId.value).toBe("");
    state.selectedSkillId.value = "review";
    await state.refreshSkills();
    expect(state.selectedSkillId.value).toBe("review");
    expect(state.isLoading.value).toBe(false);
  });

  it("clears an unavailable choice and recovers after a failed refresh", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(catalog))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(Response.json({ skills: [catalog.skills[1]] })));
    const state = useSkills();
    await state.refreshSkills();
    state.selectedSkillId.value = "review";
    await state.refreshSkills();
    expect(state.skills.value).toEqual([]);
    expect(state.selectedSkillId.value).toBe("");
    expect(state.error.value).toBe("Offline");
    await state.refreshSkills();
    expect(state.error.value).toBeNull();
    expect(state.skills.value).toEqual([catalog.skills[1]]);
    expect(state.isLoading.value).toBe(false);
  });
});
