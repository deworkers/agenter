import { afterEach, describe, expect, it, vi } from "vitest";
import { useSkills } from "./useSkills.js";

const catalog = { skills: [
  { id: "review", name: "Code review", description: "Review code" },
  { id: "research", name: "Research", description: "Find sources" },
] };

afterEach(() => vi.unstubAllGlobals());

describe("skill selection", () => {
  it("creates and selects a new skill", async () => {
    const created = { id: "my-skill", name: "My Skill", description: "Do something" };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(created, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const state = useSkills();
    await state.addSkill({ ...created, instructions: "Detailed steps" });
    expect(state.skills.value).toEqual([created]);
    expect(state.selectedSkillId.value).toBe("my-skill");
    expect(state.addError.value).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
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

  it("toggles one skill at a time and ignores unknown skills", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(catalog)));
    const state = useSkills();
    await state.refreshSkills();

    state.toggleSkill("review");
    expect(state.selectedSkillId.value).toBe("review");
    state.toggleSkill("research");
    expect(state.selectedSkillId.value).toBe("research");
    state.toggleSkill("research");
    expect(state.selectedSkillId.value).toBe("");
    state.toggleSkill("missing");
    expect(state.selectedSkillId.value).toBe("");
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
