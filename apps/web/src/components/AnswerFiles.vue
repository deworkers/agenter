<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { ResponseFormat } from "../api/types.js";
import { answerFileMediaType, answerFiles, previewDocument, saveTextFile, type AnswerFile } from "../composables/answerFiles.js";
const props = defineProps<{ content: string; responseFormat?: ResponseFormat }>();
const files = computed(() => answerFiles(props.content, props.responseFormat));
const opened = ref<AnswerFile | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
watch(opened, async () => { await nextTick(); closeButton.value?.focus(); });
const preview = computed(() => opened.value ? previewDocument(opened.value, opened.value.format === "markdown" ? DOMPurify.sanitize(marked.parse(opened.value.content, { async: false })) : undefined) : null);
function open(file: AnswerFile): void {
  opened.value = file;
}
function download(file: AnswerFile): void {
  saveTextFile(file.name, file.content, answerFileMediaType(file.format));
}
</script>

<template>
  <div
    v-if="files.length"
    class="answer-files"
    aria-label="Файлы ответа"
  >
    <article
      v-for="file in files"
      :key="file.name"
      class="answer-file"
    >
      <span
        class="answer-file-icon"
        aria-hidden="true"
      >{{ file.format === 'html' ? '⌘' : '↓' }}</span>
      <div class="answer-file-info">
        <strong>{{ file.name }}</strong><small>{{ file.format === 'html' ? 'HTML · документ' : 'Markdown · документ' }}</small>
      </div>
      <div class="answer-file-actions">
        <button
          type="button"
          @click="download(file)"
        >
          Скачать
        </button>
        <button
          type="button"
          @click="open(file)"
        >
          Открыть
        </button>
      </div>
    </article>
  </div>
  <p
    v-else-if="responseFormat && responseFormat !== 'text' && content.trim()"
    class="file-format-warning"
    role="status"
  >
    Модель не вернула завершённый файл в выбранном формате. Повторите запрос на полный документ или выберите другую модель.
  </p>
  <Teleport to="body">
    <div
      v-if="opened && preview"
      class="file-preview-backdrop"
      @click.self="opened=null"
      @keydown.esc="opened=null"
    >
      <section
        class="file-preview-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="`Просмотр ${opened.name}`"
        tabindex="-1"
      >
        <header>
          <div><strong>{{ opened.name }}</strong><small>Предпросмотр документа</small></div>
          <button
            type="button"
            @click="download(opened)"
          >
            Скачать
          </button>
          <button
            ref="closeButton"
            type="button"
            class="icon-button"
            aria-label="Закрыть просмотр файла"
            @click="opened=null"
          >
            ×
          </button>
        </header>
        <iframe
          :title="opened.name"
          :sandbox="preview.sandbox"
          :srcdoc="preview.document"
          referrerpolicy="no-referrer"
        />
      </section>
    </div>
  </Teleport>
</template>
