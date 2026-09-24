<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  disabled: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
}>();

const draft = ref("");

function submit(): void {
  const content = draft.value.trim();
  if (content.length === 0 || props.disabled) return;
  emit("send", content);
  draft.value = "";
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <form
    class="message-input"
    @submit.prevent="submit"
  >
    <div class="message-input-inner">
      <textarea
        v-model="draft"
        :disabled="props.disabled"
        placeholder="Спросите что-нибудь или опишите задачу…"
        rows="2"
        @keydown="onKeydown"
      />
      <button
        type="submit"
        aria-label="Отправить сообщение"
        :disabled="props.disabled || draft.trim().length === 0"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  </form>
</template>
