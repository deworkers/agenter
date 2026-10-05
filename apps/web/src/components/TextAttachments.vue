<script setup lang="ts">
import { textBytes } from "@agenter/agent-core";
import type { TextAttachment } from "../api/types.js";
import { saveTextFile } from "../composables/answerFiles.js";
defineProps<{ items: TextAttachment[]; removable?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ remove: [id: string]; insert: [id: string] }>();
function size(content: string): string {
  const bytes = textBytes(content); return bytes < 1024 ? `${bytes} Б` : `${(bytes / 1024).toFixed(1)} КБ`;
}
</script>

<template>
  <div
    v-if="items.length"
    class="text-attachments"
    aria-label="Текстовые вложения"
  >
    <article
      v-for="item in items"
      :key="item.id"
      class="text-attachment"
    >
      <div class="attachment-heading">
        <span
          class="attachment-icon"
          aria-hidden="true"
        >{{ item.source === 'clipboard' ? '▤' : '⌑' }}</span>
        <strong :title="item.name">{{ item.source === 'clipboard' ? 'Из буфера' : item.name }}</strong>
        <button
          v-if="removable"
          type="button"
          class="attachment-remove"
          :disabled="disabled"
          :aria-label="`Удалить ${item.name}`"
          @click="emit('remove',item.id)"
        >
          ×
        </button>
      </div>
      <small
        v-if="removable && item.source === 'clipboard'"
        class="attachment-note"
      >Длинный текст добавлен как файл.</small>
      <details>
        <summary>{{ size(item.content) }} · Посмотреть текст</summary>
        <pre>{{ item.content || '(Пустой файл)' }}</pre>
      </details>
      <button
        v-if="removable && item.source === 'clipboard'"
        type="button"
        class="attachment-restore"
        :disabled="disabled"
        @click="emit('insert', item.id)"
      >
        Вставить в поле
      </button>
      <button
        v-if="!removable"
        type="button"
        class="attachment-download"
        @click="saveTextFile(item.name, item.content)"
      >
        Скачать
      </button>
    </article>
  </div>
</template>
