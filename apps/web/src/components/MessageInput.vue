<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import type { TextAttachment } from "../api/types.js";
import { useTextAttachments } from "../composables/useTextAttachments.js";
import { useCommandSuggestions } from "../composables/useCommandSuggestions.js";
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
const textarea = ref<HTMLTextAreaElement | null>(null);
const commandListId = useId();
const commandState = useCommandSuggestions(draft, () => props.draftKey, () => !!props.streaming);
const { suggestions, activeIndex } = commandState;
defineExpose({ focus: () => textarea.value?.focus() });
const { error, loading, addFiles, paste, insertClipboard } = useTextAttachments(attachments, () => props.draftKey);
const canSend = computed(() => !props.disabled && !loading.value && (!!draft.value.trim() || !!attachments.value.length));
async function pickFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []); input.value = ""; await addFiles(files);
}
function dropFiles(event: DragEvent): void {
  if (!props.streaming) void addFiles(Array.from(event.dataTransfer?.files ?? []));
}

function restoreClipboard(id: string): void {
  const start = textarea.value?.selectionStart ?? draft.value.length;
  const end = textarea.value?.selectionEnd ?? start;
  try {
    const inserted = insertClipboard(id, draft.value, start, end);
    draft.value = inserted.value;
    error.value = "";
    void nextTick(() => {
      textarea.value?.focus();
      textarea.value?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Не удалось вставить текст";
  }
}

function submit(): void {
  const content = draft.value.trim();
  if (!canSend.value) return;
  emit("send", content, attachments.value.map(item => ({ ...item })));
  draft.value = "";
  // Slash commands preserve the pending documents for the next actual prompt.
  if (!content.startsWith("/")) attachments.value = [];
}

function updateSelection(): void {
  if (textarea.value) commandState.updateSelection(textarea.value.selectionStart, textarea.value.selectionEnd);
}
function focusCommands(): void {
  if (textarea.value) commandState.focus(textarea.value.selectionStart, textarea.value.selectionEnd);
}
function setCursor(cursor: number): void {
  void nextTick(() => {
    textarea.value?.focus();
    textarea.value?.setSelectionRange(cursor, cursor);
    updateSelection();
  });
}
function chooseCommand(index: number): void {
  const cursor = commandState.complete(index);
  if (cursor !== undefined) setCursor(cursor);
}
function onKeydown(event: KeyboardEvent): void {
  updateSelection();
  const result = commandState.handleKeydown(event);
  if (result.handled) {
    event.preventDefault();
    if (result.cursor !== undefined) setCursor(result.cursor);
    return;
  }
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
      @insert="restoreClipboard"
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
      <ul
        v-if="suggestions.length"
        :id="commandListId"
        class="command-suggestions"
        role="listbox"
        aria-label="Слеш-команды"
      >
        <li
          v-for="(command, index) in suggestions"
          :id="`${commandListId}-${index}`"
          :key="command.name"
          role="option"
          :aria-selected="index === activeIndex"
          @pointerdown.prevent
          @click="chooseCommand(index)"
          @mouseenter="activeIndex = index"
        >
          <strong>/{{ command.name }}</strong>
          <span>{{ command.description }}</span>
        </li>
      </ul>
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
          <path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9M6 15l8-8" />
        </svg>
        <span>Файл</span>
      </button>
      <textarea
        ref="textarea"
        v-model="draft"
        :disabled="props.streaming"
        aria-label="Сообщение"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-expanded="!!suggestions.length"
        :aria-controls="suggestions.length ? commandListId : undefined"
        :aria-activedescendant="suggestions.length ? `${commandListId}-${activeIndex}` : undefined"
        placeholder="Напишите, что нужно сделать…"
        rows="2"
        @keydown="onKeydown"
        @keyup="updateSelection"
        @click="updateSelection"
        @select="updateSelection"
        @input="focusCommands"
        @focus="focusCommands"
        @blur="commandState.blur"
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
