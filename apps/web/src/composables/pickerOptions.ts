import type { ProviderSummary, SkillSummary } from "../api/types.js";
import type { PickerOption } from "./useOptionPicker.js";

export function providerPickerOptions(providers: ProviderSummary[], defaultProviderId: string): PickerOption[] {
  return [
    {
      value: "auto",
      label: "Автоматически",
      detail: defaultProviderId ? `Выбор по задаче · базовая модель ${defaultProviderId}` : "Выбор модели по задаче",
      triggerLabel: "Auto",
      badge: "По задаче",
    },
    ...providers.map((provider) => ({
      value: provider.id,
      label: provider.id,
      detail: provider.model,
      triggerLabel: `${provider.id} · ${provider.model.split(/[\\/]/).at(-1) ?? provider.model}`,
      badge: provider.id === defaultProviderId ? "По умолчанию" : undefined,
    })),
  ];
}

export function skillPickerOptions(skills: SkillSummary[]): PickerOption[] {
  return [
    { value: "", label: "Без навыка", detail: "Без дополнительных инструкций", triggerLabel: "Без навыка" },
    ...skills.map((skill) => ({
      value: skill.id,
      label: skill.name,
      detail: skill.description,
      triggerLabel: skill.name,
      badge: skill.id,
    })),
  ];
}
