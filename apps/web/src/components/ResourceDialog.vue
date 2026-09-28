<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { createModelDraft, createServerDraft, type ResourceDraft } from "../composables/resourceDrafts.js";
const props = defineProps<{ kind: "model" | "mcp"; existingIds: string[] }>();
const emit = defineEmits<{ close: []; create: [draft: ResourceDraft] }>();
const idInput = ref<HTMLInputElement | null>(null);
const fields = reactive({ id: "", label: "", baseUrl: "http://localhost:1234/v1", apiKey: "local", model: "", contextWindow: 8192, maxOutputTokens: 1024, transport: "sse" as "sse" | "stdio", url: "", command: "", argsText: "", envText: "" });
const error = ref("");
onMounted(() => idInput.value?.focus());
function submit(): void {
  try {
    const draft = props.kind === "model" ? createModelDraft(fields) : createServerDraft(fields);
    if (props.existingIds.includes(draft.id)) throw new Error("Этот ID уже используется");
    emit("create", draft);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Проверьте поля"; }
}
</script>

<template>
  <div
    class="dialog-backdrop resource-backdrop"
    @keydown.esc.stop="emit('close')"
    @click.self="emit('close')"
  >
    <section
      class="resource-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-title"
    >
      <header class="skill-dialog-header">
        <div>
          <h2 id="resource-title">
            {{ kind === 'model' ? 'Добавить модель' : 'Добавить MCP-сервис' }}
          </h2><p>Заполните подключение. Запись появится в настройках после добавления.</p>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="Закрыть добавление"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <form
        class="settings-form resource-form"
        @submit.prevent="submit"
      >
        <label>ID<input
          ref="idInput"
          v-model="fields.id"
          required
          maxlength="64"
          placeholder="Например, local-code или search"
        ><small>Уникальное имя для настроек и команд чата.</small></label>
        <template v-if="kind === 'model'">
          <label>Название<input
            v-model="fields.label"
            maxlength="120"
            placeholder="Например, Локальная модель"
          ></label>
          <label>Endpoint<input
            v-model="fields.baseUrl"
            required
            placeholder="http://localhost:1234/v1"
          ><small>Базовый адрес OpenAI-compatible API, обычно заканчивается на /v1.</small></label>
          <label>Идентификатор модели<input
            v-model="fields.model"
            required
            maxlength="1000"
            placeholder="Название модели на сервере"
          ></label>
          <label>Переменная ключа<input
            v-model="fields.apiKey"
            placeholder="${MODEL_API_KEY}"
          ><small>Для удалённого сервера — ${ENV_NAME}, для локального — local или пустое поле.</small></label>
          <div class="settings-columns">
            <label>Окно контекста<input
              v-model.number="fields.contextWindow"
              type="number"
              min="128"
              max="10000000"
              required
            ></label>
            <label>Лимит ответа<input
              v-model.number="fields.maxOutputTokens"
              type="number"
              min="1"
              max="1000000"
              required
            ></label>
          </div>
        </template>
        <template v-else>
          <label>Подключение<select v-model="fields.transport"><option value="sse">SSE — сервер по URL</option><option value="stdio">stdio — локальная команда</option></select></label>
          <label v-if="fields.transport === 'sse'">URL сервера<input
            v-model="fields.url"
            required
            placeholder="http://localhost:8000/sse"
          ></label>
          <template v-else>
            <label>Команда<input
              v-model="fields.command"
              required
              placeholder="npx, node или полный путь к программе"
            ></label>
            <label>Аргументы<textarea
              v-model="fields.argsText"
              rows="3"
              placeholder="-y&#10;@scope/mcp-server"
            /><small>Каждый аргумент на отдельной строке. Кавычки не нужны.</small></label>
            <label>Переменные окружения<textarea
              v-model="fields.envText"
              rows="3"
              placeholder="API_TOKEN=${MCP_TOKEN}"
            /><small>NAME=value, по одной переменной на строку. Секреты — через ${ENV_NAME}.</small></label>
          </template>
          <small>После добавления проверьте подключение и выберите разрешённые функции в настройках MCP.</small>
        </template>
        <p
          v-if="error"
          class="skill-form-error"
          role="alert"
        >
          {{ error }}
        </p>
        <div class="resource-actions">
          <small>Для применения записи затем нажмите «Сохранить настройки».</small><button
            class="secondary-button"
            type="button"
            @click="emit('close')"
          >
            Отмена
          </button><button
            class="primary-button"
            type="submit"
          >
            Добавить в список
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
