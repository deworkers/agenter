<script setup lang="ts">
import { computed, ref } from "vue";
import { filterMcpTools, selectMcpTools, summarizeMcpSelection, type SelectableMcpTool } from "../composables/mcpToolSelection.js";

const props = defineProps<{ tools: SelectableMcpTool[]; modelValue: string[] | undefined }>();
const emit = defineEmits<{ "update:modelValue": [value: string[] | undefined] }>();
const query = ref("");
const activeOnly = ref(false);
const summary = computed(() => summarizeMcpSelection(props.tools, props.modelValue));
const filtered = computed(() => filterMcpTools(props.tools, props.modelValue, query.value, activeOnly.value));
const isFiltered = computed(() => Boolean(query.value.trim()) || activeOnly.value);

function change(names: string[], checked: boolean): void {
  emit("update:modelValue", selectMcpTools(props.tools, props.modelValue, names, checked));
}
function changeVisible(checked: boolean): void {
  const names = filtered.value.map(tool => tool.name);
  if (!isFiltered.value && !checked) names.push(...(props.modelValue ?? []));
  change(names, checked);
}
function changeAllMode(checked: boolean): void {
  emit("update:modelValue", checked ? undefined : selectMcpTools(props.tools, undefined, [], true));
}
</script>

<template>
  <section
    class="mcp-tool-selection"
    aria-label="Активные инструменты MCP"
  >
    <div class="mcp-tools-heading">
      <h3>Активные инструменты</h3>
      <span role="status">{{ summary.activeCount }} из {{ tools.length }}</span>
    </div>
    <p class="mcp-tools-help">
      Только активные функции передаются модели и доступны для вызова.
      Отключите ненужные, чтобы уменьшить расход контекста.
    </p>
    <label class="check-label">
      <input
        type="checkbox"
        :checked="modelValue === undefined"
        @change="changeAllMode(($event.target as HTMLInputElement).checked)"
      >
      Включать все инструменты, в том числе новые
    </label>
    <small class="mcp-tools-mode-hint">
      {{ modelValue === undefined
        ? 'Включены все функции, включая операции записи. Снятие отдельной функции переключит на выбранный набор.'
        : 'Выбранный набор сохраняется для этого сервера. Новые функции автоматически не включаются.' }}
    </small>
    <template v-if="tools.length">
      <div class="mcp-tools-filters">
        <input
          v-model="query"
          type="search"
          aria-label="Поиск инструментов MCP"
          placeholder="Название или описание"
        >
        <label class="check-label">
          <input
            v-model="activeOnly"
            type="checkbox"
          >
          Только активные
        </label>
      </div>
      <div class="mcp-tools-actions">
        <button
          type="button"
          class="secondary-button"
          :disabled="!filtered.length"
          @click="changeVisible(true)"
        >
          {{ isFiltered ? 'Выбрать найденные' : 'Выбрать все' }}
        </button>
        <button
          type="button"
          class="secondary-button"
          :disabled="!filtered.length && !summary.unavailableNames.length"
          @click="changeVisible(false)"
        >
          {{ isFiltered ? 'Снять найденные' : 'Снять все' }}
        </button>
        <span v-if="isFiltered">Найдено: {{ filtered.length }}</span>
      </div>
      <div class="mcp-tools-list">
        <div
          v-for="tool in filtered"
          :key="tool.name"
          class="mcp-tool-row"
        >
          <label class="settings-tool">
            <input
              type="checkbox"
              :aria-label="`Инструмент ${tool.name}`"
              :checked="modelValue === undefined || modelValue.includes(tool.name)"
              @change="change([tool.name], ($event.target as HTMLInputElement).checked)"
            >
            <strong>{{ tool.name }}</strong>
          </label>
          <details
            v-if="tool.description"
            class="mcp-tool-description"
          >
            <summary :aria-label="`Описание инструмента ${tool.name}`">
              <span class="mcp-tool-preview">{{ tool.description }}</span>
              <span class="mcp-tool-description-label">Описание</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <p>{{ tool.description }}</p>
          </details>
        </div>
        <p
          v-if="!filtered.length"
          class="mcp-tools-help"
        >
          Инструменты не найдены. Измените поиск или фильтр.
        </p>
      </div>
    </template>
    <p
      v-else
      class="mcp-tools-help"
    >
      Проверьте подключение, чтобы получить каталог инструментов.
    </p>
    <p
      v-if="modelValue !== undefined && !summary.activeCount && tools.length"
      class="mcp-tools-help"
    >
      Нет активных функций. Этот сервер не добавит инструменты в контекст модели.
    </p>
    <p
      v-if="summary.unavailableNames.length"
      class="mcp-tools-help"
    >
      Сохранены в настройках, но отсутствуют в каталоге: {{ summary.unavailableNames.join(', ') }}.
    </p>
  </section>
</template>
