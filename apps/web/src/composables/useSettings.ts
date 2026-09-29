import { ref } from "vue";
import { getSettings, saveSettings, testConnection } from "../api/client.js";
import type { Settings } from "../api/types.js";

export function useSettings() {
  const settings = ref<Settings | null>(null);
  const environment = ref<Record<string, boolean>>({});
  const loading = ref(false);
  const saving = ref(false);
  const error = ref("");
  const notice = ref("");
  const testing = ref(false);
  async function load(): Promise<void> {
    loading.value = true; error.value = "";
    try {
      const result = await getSettings();
      for (const model of Object.values(result.settings.providers)) { model.contextWindow ??= 8192; model.maxOutputTokens ??= 1024; model.timeoutMs ??= 600000; }
      settings.value = result.settings; environment.value = result.environment;
    }
    catch (cause) { error.value = cause instanceof Error ? cause.message : "Не удалось загрузить настройки"; }
    finally { loading.value = false; }
  }
  async function save(): Promise<boolean> {
    if (!settings.value || saving.value) return false;
    saving.value = true; error.value = ""; notice.value = "";
    try { settings.value = (await saveSettings(settings.value)).settings; notice.value = "Настройки сохранены и применены к новым запросам"; return true; }
    catch (cause) { error.value = cause instanceof Error ? cause.message : "Не удалось сохранить настройки"; return false; }
    finally { saving.value = false; }
  }
  async function test(kind: "model" | "mcp", id: string) {
    if (!settings.value || testing.value) return undefined;
    testing.value = true; error.value = ""; notice.value = "";
    try { const result = await testConnection(settings.value, kind, id); notice.value = kind === "model" ? "Endpoint доступен. Проверка генерации не выполнялась." : "MCP подключён"; return result; }
    catch (cause) { error.value = cause instanceof Error ? cause.message : "Подключение не удалось"; return undefined; }
    finally { testing.value = false; }
  }
  return { settings, environment, loading, saving, error, notice, testing, load, save, test };
}
