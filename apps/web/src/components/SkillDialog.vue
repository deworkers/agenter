<script setup lang="ts">
import { ref, watch } from "vue";
import type { NewSkillInput } from "../api/types.js";
import { skillIdFromName } from "../composables/skillId.js";

defineProps<{ saving: boolean; error: string | null }>();
const emit = defineEmits<{ close: []; create: [input: NewSkillInput] }>();
const name = ref("");
const id = ref("");
const description = ref("");
const instructions = ref("");
const editedId = ref(false);

watch(name, (value) => {
  if (!editedId.value) id.value = skillIdFromName(value);
});

function submit(): void {
  emit("create", {
    id: id.value.trim(),
    name: name.value.trim(),
    description: description.value.trim(),
    instructions: instructions.value.trim(),
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
      class="skill-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-dialog-title"
    >
      <div class="skill-dialog-header">
        <div>
          <h2 id="skill-dialog-title">
            Новый навык
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
            {{ saving ? 'Сохраняем…' : 'Создать и выбрать' }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
