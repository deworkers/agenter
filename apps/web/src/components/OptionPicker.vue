<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, toRef, useId, watch } from "vue";
import { useOptionPicker, type PickerOption } from "../composables/useOptionPicker.js";

const props = withDefaults(defineProps<{
  label: string;
  options: PickerOption[];
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  align?: "start" | "end";
}>(), {
  disabled: false,
  placeholder: "Не выбрано",
  searchPlaceholder: "Поиск…",
  emptyText: "Ничего не найдено",
  align: "start",
});

const value = defineModel<string>({ required: true });
const picker = useOptionPicker(toRef(props, "options"), value);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
const placement = ref<"above" | "below">("above");
const maxHeight = ref(320);
const menuLeft = ref(0);
const id = useId();
const listId = `picker-list-${id}`;
const labelId = `picker-label-${id}`;

function outsidePointer(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) closeMenu();
}

function closeMenu(restoreFocus = false): void {
  picker.close();
  document.removeEventListener("pointerdown", outsidePointer);
  window.removeEventListener("resize", onViewportResize);
  if (restoreFocus) trigger.value?.focus();
}

function onViewportResize(): void {
  closeMenu();
}

async function openMenu(): Promise<void> {
  if (props.disabled || picker.isOpen.value) return;
  const bounds = trigger.value?.getBoundingClientRect();
  if (bounds) {
    const above = bounds.top;
    const below = window.innerHeight - bounds.bottom;
    placement.value = above >= 280 || above > below ? "above" : "below";
    maxHeight.value = Math.max(100, Math.min(360, (placement.value === "above" ? above : below) - 14));
    const width = Math.min(380, window.innerWidth - 32);
    const desiredLeft = props.align === "end" ? bounds.right - width : bounds.left;
    menuLeft.value = Math.max(16, Math.min(desiredLeft, window.innerWidth - width - 16)) - bounds.left;
  }
  picker.open();
  document.addEventListener("pointerdown", outsidePointer);
  window.addEventListener("resize", onViewportResize);
  await nextTick();
  search.value?.focus();
  scrollToActive();
}

function toggleMenu(): void {
  if (picker.isOpen.value) closeMenu();
  else void openMenu();
}

function choose(option: PickerOption): void {
  picker.select(option.value);
  closeMenu(true);
}

function scrollToActive(): void {
  const option = list.value?.children.item(picker.activeIndex.value) as HTMLElement | null;
  option?.scrollIntoView?.({ block: "nearest" });
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    void openMenu();
  } else if (event.key === "Escape") {
    closeMenu();
  }
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    picker.move(event.key === "ArrowDown" ? 1 : -1);
    scrollToActive();
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    picker.activeIndex.value = event.key === "Home" ? 0 : picker.filtered.value.length - 1;
    scrollToActive();
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (picker.filtered.value.length) {
      picker.selectActive();
      closeMenu(true);
    }
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeMenu(true);
  } else if (event.key === "Tab") {
    closeMenu();
  }
}

watch(() => props.disabled, (disabled) => { if (disabled) closeMenu(); });
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outsidePointer);
  window.removeEventListener("resize", onViewportResize);
});
</script>

<template>
  <div
    ref="root"
    class="option-picker"
    :class="{ 'option-picker-open': picker.isOpen.value }"
  >
    <button
      ref="trigger"
      class="picker-trigger"
      type="button"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="picker.isOpen.value"
      :aria-controls="picker.isOpen.value ? listId : undefined"
      :title="picker.selectedOption.value?.detail ?? picker.selectedOption.value?.label"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span
        :id="labelId"
        class="picker-label"
      >{{ label }}</span>
      <span class="picker-value">{{ picker.selectedOption.value?.triggerLabel ?? picker.selectedOption.value?.label ?? placeholder }}</span>
      <svg
        class="picker-chevron"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <div
      v-if="picker.isOpen.value"
      class="picker-popover"
      :class="`picker-${placement}`"
      :style="{ maxHeight: `${maxHeight}px`, left: `${menuLeft}px` }"
    >
      <div class="picker-popover-heading">
        {{ label }}
      </div>
      <div class="picker-search">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle
            cx="10.8"
            cy="10.8"
            r="6.8"
          />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <input
          ref="search"
          v-model="picker.query.value"
          role="combobox"
          aria-autocomplete="list"
          :aria-label="searchPlaceholder"
          :aria-controls="listId"
          :aria-expanded="true"
          :aria-activedescendant="picker.activeIndex.value >= 0 ? `${listId}-${picker.activeIndex.value}` : undefined"
          :placeholder="searchPlaceholder"
          @keydown="onSearchKeydown"
        >
      </div>
      <div
        :id="listId"
        ref="list"
        class="picker-list"
        role="listbox"
        :aria-labelledby="labelId"
      >
        <button
          v-for="(option, index) in picker.filtered.value"
          :id="`${listId}-${index}`"
          :key="option.value"
          class="picker-option"
          :class="{ 'picker-option-active': index === picker.activeIndex.value }"
          type="button"
          role="option"
          tabindex="-1"
          :aria-selected="option.value === value"
          @mouseenter="picker.activeIndex.value = index"
          @click="choose(option)"
        >
          <span class="picker-option-copy">
            <span class="picker-option-main">
              <strong>{{ option.label }}</strong>
              <span
                v-if="option.badge"
                class="picker-badge"
              >{{ option.badge }}</span>
            </span>
            <span
              v-if="option.detail"
              class="picker-option-detail"
            >{{ option.detail }}</span>
          </span>
          <svg
            v-if="option.value === value"
            class="picker-check"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
        </button>
        <p
          v-if="picker.filtered.value.length === 0"
          class="picker-empty"
        >
          {{ emptyText }}
        </p>
      </div>
    </div>
  </div>
</template>
