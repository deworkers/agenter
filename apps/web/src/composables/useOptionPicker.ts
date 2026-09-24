import { computed, ref, watch, type Ref } from "vue";

export interface PickerOption {
  value: string;
  label: string;
  detail?: string;
  badge?: string;
  triggerLabel?: string;
}

export function useOptionPicker(options: Ref<PickerOption[]>, selected: Ref<string>) {
  const isOpen = ref(false);
  const query = ref("");
  const activeIndex = ref(-1);
  const selectedOption = computed(() => options.value.find((option) => option.value === selected.value));
  const filtered = computed(() => {
    const needle = query.value.trim().normalize("NFKC").toLocaleLowerCase();
    return needle ? options.value.filter((option) =>
      `${option.label} ${option.detail ?? ""} ${option.badge ?? ""}`.normalize("NFKC").toLocaleLowerCase().includes(needle)
    ) : options.value;
  });

  watch(query, () => { activeIndex.value = filtered.value.length ? 0 : -1; }, { flush: "sync" });
  watch(filtered, (items) => {
    if (activeIndex.value >= items.length) activeIndex.value = items.length - 1;
  });

  function open(): void {
    query.value = "";
    isOpen.value = true;
    activeIndex.value = filtered.value.findIndex((option) => option.value === selected.value);
    if (activeIndex.value < 0 && filtered.value.length) activeIndex.value = 0;
  }

  function close(): void {
    isOpen.value = false;
    query.value = "";
  }

  function move(delta: number): void {
    const length = filtered.value.length;
    if (!length) return;
    activeIndex.value = (activeIndex.value + delta + length) % length;
  }

  function select(value: string): void {
    if (!options.value.some((option) => option.value === value)) return;
    selected.value = value;
    close();
  }

  function selectActive(): void {
    const option = filtered.value[activeIndex.value];
    if (option) select(option.value);
  }

  return { isOpen, query, activeIndex, selectedOption, filtered, open, close, move, select, selectActive };
}
