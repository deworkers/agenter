import { ref } from "vue";
import { createSkill, listSkills } from "../api/client.js";
import type { NewSkillInput, SkillSummary } from "../api/types.js";

export function useSkills() {
  const skills = ref<SkillSummary[]>([]);
  const selectedSkillId = ref("");
  const isLoading = ref(true);
  const error = ref<string | null>(null);
  const isAdding = ref(false);
  const addError = ref<string | null>(null);

  function toggleSkill(id: string): void {
    if (!skills.value.some((skill) => skill.id === id)) return;
    selectedSkillId.value = selectedSkillId.value === id ? "" : id;
  }

  async function addSkill(input: NewSkillInput): Promise<boolean> {
    isAdding.value = true;
    addError.value = null;
    try {
      const created = await createSkill(input);
      skills.value = [...skills.value.filter((skill) => skill.id !== created.id), created].sort((a, b) => a.id.localeCompare(b.id));
      selectedSkillId.value = created.id;
      error.value = null;
      return true;
    } catch (cause) {
      addError.value = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      isAdding.value = false;
    }
  }

  async function refreshSkills(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const catalog = await listSkills();
      skills.value = catalog.skills;
      if (!catalog.skills.some((skill) => skill.id === selectedSkillId.value)) selectedSkillId.value = "";
    } catch (cause) {
      skills.value = [];
      selectedSkillId.value = "";
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      isLoading.value = false;
    }
  }

  return { skills, selectedSkillId, isLoading, error, isAdding, addError, refreshSkills, addSkill, toggleSkill };
}
