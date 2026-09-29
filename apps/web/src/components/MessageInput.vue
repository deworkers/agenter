<script setup lang="ts">
import { computed, ref } from "vue";
import type { TextAttachment } from "../api/types.js";
import { useTextAttachments } from "../composables/useTextAttachments.js";
import { textFileAccept } from "../composables/textFiles.js";
import TextAttachments from "./TextAttachments.vue";

const props = defineProps<{
  disabled: boolean;
  streaming?: boolean;
  draftKey: string;
}>();

const emit = defineEmits<{
  send: [content: string, attachments: TextAttachment[]];
  stop: [];
}>();

const draft = defineModel<string>("draft", { default: "" });
const attachments = defineModel<TextAttachment[]>("attachments", { required: true });
const fileInput = ref<HTMLInputElement | null>(null);
const { error, loading, addFiles, paste } = useTextAttachments(attachments, () => props.draftKey);
const canSend = computed(() => !props.disabled && !loading.value && (!!draft.value.trim() || !!attachments.value.length));
async function pickFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []); input.value = ""; await addFiles(files);
}
function dropFiles(event: DragEvent): void {
  if (!props.streaming) void addFiles(Array.from(event.dataTransfer?.files ?? []));
}

function submit(): void {
  const content = draft.value.trim();
  if (!canSend.value) return;
  emit("send", content, attachments.value.map(item => ({ ...item })));
  draft.value = "";
  // Slash commands preserve the pending documents for the next actual prompt.
  if (!content.startsWith("/")) attachments.value = [];
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <form
    class="message-input"
    @submit.prevent="submit"
    @dragover.prevent
    @drop.prevent="dropFiles"
  >
    <TextAttachments
      :items="attachments"
      removable
      :disabled="streaming || loading"
      @remove="(id) => attachments = attachments.filter(item => item.id !== id)"
    />
    <p
      v-if="error"
      class="attachment-error"
      role="alert"
    >
      {{ error }}
    </p>
    <input
      ref="fileInput"
      type="file"
      :accept="textFileAccept"
      multiple
      hidden
      :disabled="streaming || loading"
      @change="pickFiles"
    >
    <div class="message-input-inner">
      <button
        type="button"
        class="attach-button"
        :disabled="streaming || loading"
        aria-label="Добавить текстовые файлы"
        title="Добавить текстовые файлы"
        @click="fileInput?.click()"
      >
        <span
          v-if="loading"
          aria-hidden="true"
        >…</span>
        <svg
          v-else
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <textarea
        v-model="draft"
        :disabled="props.streaming"
        placeholder="Сообщение или команда: /model, /new, /compact"
        rows="2"
        @keydown="onKeydown"
        @paste="paste"
      />
      <button
        v-if="!streaming"
        type="submit"
        aria-label="Отправить сообщение"
        :disabled="!canSend"
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
      <button
        v-else
        type="button"
        class="stop-button"
        aria-label="Остановить генерацию"
        @click="emit('stop')"
      >
        ■
      </button>
    </div>
  </form>
</template>
