import { ref } from "vue";
import { listSkills } from "../api/client.js";
import type { SkillSummary } from "../api/types.js";

export function useSkills() {
  const skills = ref<SkillSummary[]>([]);
  const selectedSkillId = ref("");
  const isLoading = ref(true);
  const error = ref<string | null>(null);

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

  return { skills, selectedSkillId, isLoading, error, refreshSkills };
}
