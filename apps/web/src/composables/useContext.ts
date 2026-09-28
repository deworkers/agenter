import { onScopeDispose, ref, watch } from "vue";
import { previewContext } from "../api/client.js";
import type { ContextBudget, SendMessageOptions } from "../api/types.js";

export function useContext(input: () => { chatId: string; content: string; options: SendMessageOptions; revision: number; streaming: boolean }) {
  const budget = ref<ContextBudget | null>(null);
  const model = ref("");
  const error = ref("");
  const updating = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const stop = watch(input, (value) => {
    clearTimeout(timer); controller?.abort();
    if (value.streaming) { updating.value = false; return; }
    updating.value = true;
    timer = setTimeout(async () => {
      const current = new AbortController(); controller = current;
      try {
        const result = await previewContext(value.chatId, value.content, value.options, current.signal);
        if (current.signal.aborted) return;
        budget.value = result.context.budget ?? null; model.value = result.model; error.value = "";
      } catch { if (!current.signal.aborted) error.value = "Оценка контекста недоступна"; }
      finally { if (!current.signal.aborted) updating.value = false; }
    }, 250);
  }, { immediate: true, deep: true });
  onScopeDispose(() => { stop(); clearTimeout(timer); controller?.abort(); });
  return { budget, model, error, updating };
}
