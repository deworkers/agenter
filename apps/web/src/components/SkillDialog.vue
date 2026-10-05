<script setup lang="ts">
import { ref, watch } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { NewSkillInput } from "../api/types.js";
import { skillIdFromName } from "../composables/skillId.js";
import { useModalFocus } from "../composables/useModalFocus.js";

const props = defineProps<{ saving: boolean; error: string | null; initial?: NewSkillInput }>();
const emit = defineEmits<{ close: []; create: [input: NewSkillInput] }>();
const name = ref(props.initial?.name ?? "");
const id = ref(props.initial?.id ?? "");
const description = ref(props.initial?.description ?? "");
const instructions = ref(props.initial?.instructions ?? "");
const editedId = ref(!!props.initial);
const enabled = ref(props.initial?.enabled !== false);
const mcpServersText = ref((props.initial?.mcpServers ?? []).join(", "));
const preview = ref(false);
const dialogElement = ref<HTMLElement | null>(null);
useModalFocus(dialogElement);
function previewHtml(): string { return DOMPurify.sanitize(marked.parse(instructions.value, { async: false })); }

watch(name, (value) => {
  if (!editedId.value) id.value = skillIdFromName(value);
});

function submit(): void {
  emit("create", {
    id: id.value.trim(),
    name: name.value.trim(),
    description: description.value.trim(),
    instructions: instructions.value.trim(),
    mcpServers: [...new Set(mcpServersText.value.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean))],
    ...(props.initial ? { enabled: enabled.value } : {}),
  });
}
</script>

<template>
  <div
    class="dialog-backdrop"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <section
      ref="dialogElement"
      class="skill-dialog"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-dialog-title"
    >
      <div class="skill-dialog-header">
        <div>
          <h2 id="skill-dialog-title">
            {{ initial ? 'Редактирование навыка' : 'Новый навык' }}
          </h2>
          <p>Инструкции навыка будут добавлены к запросу модели, когда вы выберете его в чате.</p>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="Закрыть"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
      <form
        class="skill-form"
        @submit.prevent="submit"
      >
        <label>Название
          <input
            v-model="name"
            autofocus
            required
            maxlength="120"
            placeholder="Например, Редактор текста"
          >
        </label>
        <label>ID папки
          <input
            v-model="id"
            :disabled="!!initial"
            required
            maxlength="64"
            pattern="[a-z0-9][a-z0-9-]*"
            placeholder="text-editor"
            @input="editedId = true"
          >
          <small>Латинские буквы, цифры и дефисы. Используется в каталоге skills/.</small>
        </label>
        <label>Короткое описание
          <input
            v-model="description"
            required
            maxlength="500"
            placeholder="Что делает этот навык"
          >
        </label>
        <label>Инструкции
          <textarea
            v-model="instructions"
            required
            maxlength="100000"
            rows="8"
            placeholder="Опишите шаги, ограничения и желаемый формат ответа…"
          />
          <small>Можно использовать Markdown. Содержимое будет отправляться модели вместе с вашими сообщениями.</small>
        </label>
        <label>Связанные MCP-сервисы
          <input
            v-model="mcpServersText"
            placeholder="Например, ddg-search, context7"
          >
          <small>ID из настроек MCP, через запятую. Доступные сервисы включатся при выборе навыка; недоступные будут отмечены в боковой панели.</small>
        </label>
        <label
          v-if="initial"
          class="check-label"
        ><input
          v-model="enabled"
          type="checkbox"
        >Навык включён</label>
        <button
          type="button"
          class="secondary-button"
          @click="preview=!preview"
        >
          {{ preview ? 'Скрыть предпросмотр' : 'Предпросмотр Markdown' }}
        </button>
        <!-- eslint-disable vue/no-v-html -- Preview is sanitized by DOMPurify. -->
        <div
          v-if="preview"
          class="markdown-body skill-preview"
          v-html="previewHtml()"
        />
        <!-- eslint-enable vue/no-v-html -->
        <p
          v-if="error"
          class="skill-form-error"
          role="alert"
        >
          {{ error }}
        </p>
        <div class="skill-dialog-actions">
          <button
            type="button"
            class="secondary-button"
            @click="emit('close')"
          >
            Отмена
          </button>
          <button
            type="submit"
            class="primary-button"
            :disabled="saving"
          >
            {{ saving ? 'Сохраняем…' : initial ? 'Сохранить навык' : 'Создать и выбрать' }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
