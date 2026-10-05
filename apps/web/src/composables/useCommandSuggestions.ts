import { computed, ref, watch, type Ref } from "vue";

const commands = [
  { name: "model", description: "Выбрать модель · ID или auto" },
  { name: "new", description: "Создать новый диалог" },
  { name: "compact", description: "Сжать контекст, сохранив историю" },
] as const;

type CommandKey = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
};

export function useCommandSuggestions(draft: Ref<string>, contextKey: () => string, disabled: () => boolean) {
  const focused = ref(false), dismissed = ref(false), activeIndex = ref(0);
  const selection = ref({ start: 0, end: 0 });
  const token = computed(() => /^([\t ]*)\/([a-z]*)(?=$|\s)/i.exec(draft.value));
  const suggestions = computed(() => {
    const match = token.value;
    if (!focused.value || dismissed.value || disabled() || !match) return [];
    const start = match[1]!.length + 1, end = match[0].length;
    if (selection.value.start < start || selection.value.end > end) return [];
    return commands.filter(command => command.name.startsWith(match[2]!.toLowerCase()));
  });

  watch(draft, () => { dismissed.value = false; activeIndex.value = 0; }, { flush: "sync" });
  watch([contextKey, disabled], () => { focused.value = false; activeIndex.value = 0; }, { flush: "sync" });

  function updateSelection(start: number, end: number): void { selection.value = { start, end }; }
  function focus(start: number, end: number): void {
    updateSelection(start, end); focused.value = true; dismissed.value = false;
  }
  function blur(): void { focused.value = false; }
  function complete(index: number): number | undefined {
    const command = suggestions.value[index], match = token.value;
    if (!command || !match) return;
    const suffix = draft.value.slice(match[0].length);
    draft.value = `${match[1]!}/${command.name}${suffix || " "}`;
    dismissed.value = true;
    const cursor = match[1]!.length + command.name.length + 2;
    updateSelection(cursor, cursor);
    return cursor;
  }
  function handleKeydown(event: CommandKey): { handled: boolean; cursor?: number } {
    if (event.isComposing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || !suggestions.value.length) return { handled: false };
    if (event.key === "Escape") { dismissed.value = true; return { handled: true }; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      activeIndex.value = (activeIndex.value + step + suggestions.value.length) % suggestions.value.length;
      return { handled: true };
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const cursor = complete(activeIndex.value);
      if (cursor !== undefined) return { handled: true, cursor };
    }
    return { handled: false };
  }

  return { suggestions, activeIndex, focus, blur, updateSelection, complete, handleKeydown };
}
