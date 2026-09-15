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
    <textarea
      v-model="draft"
      :disabled="props.disabled"
      placeholder="Message..."
      rows="2"
      @keydown="onKeydown"
    />
    <button
      type="submit"
      :disabled="props.disabled || draft.trim().length === 0"
    >
      Send
    </button>
  </form>
</template>
