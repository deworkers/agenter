import { ref } from "vue";
import * as client from "../api/client.js";
import type { AuthUser } from "../api/client.js";

export function useAuth() {
  const user = ref<AuthUser | null>(null);
  const loading = ref(true);
  const busy = ref(false);
  const error = ref("");
  let restoring: Promise<void> | undefined;
  let revision = 0;
  function restore(): Promise<void> {
    if (busy.value) return Promise.resolve();
    const current = revision;
    restoring ??= (async () => {
      try {
        const session = await client.getSession();
        if (current === revision) { user.value = session; error.value = ""; }
      }
      catch { if (current === revision) error.value = "Не удалось проверить вход. Проверьте подключение и повторите."; }
      finally { loading.value = false; restoring = undefined; }
    })();
    return restoring;
  }
  async function submit(action: "login" | "register", login: string, password: string): Promise<boolean> {
    if (busy.value) return false;
    revision++;
    busy.value = true; error.value = "";
    try { user.value = await client.authenticate(action, login, password); return true; }
    catch (cause) { error.value = cause instanceof Error ? cause.message : "Не удалось выполнить вход"; return false; }
    finally { busy.value = false; }
  }
  async function logout(): Promise<boolean> {
    if (busy.value) return false;
    revision++;
    busy.value = true; error.value = "";
    try { await client.logout(); user.value = null; return true; }
    catch { error.value = "Не удалось выйти. Проверьте подключение и повторите."; return false; }
    finally { busy.value = false; }
  }
  return { user, loading, busy, error, restore, submit, logout };
}
