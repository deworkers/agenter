<script setup lang="ts">
import type { McpServerSummary, McpToolSummary } from "../api/types.js";

defineProps<{
  servers: McpServerSummary[];
  tools: McpToolSummary[];
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{ close: []; refresh: [] }>();
</script>

<template>
  <aside
    class="mcp-panel"
    aria-label="MCP инструменты"
  >
    <div class="mcp-panel-header">
      <div>
        <h2>Инструменты</h2>
        <p>Доступные MCP-серверы и функции</p>
      </div>
      <button
        class="icon-button"
        type="button"
        aria-label="Закрыть панель инструментов"
        @click="emit('close')"
      >
        ×
      </button>
    </div>
    <div class="mcp-panel-content">
      <div
        v-if="loading"
        class="panel-empty"
      >
        Загрузка инструментов…
      </div>
      <div
        v-else-if="error"
        class="panel-empty"
        role="alert"
      >
        <p>Не удалось загрузить инструменты: {{ error }}</p>
        <button
          class="text-button"
          type="button"
          @click="emit('refresh')"
        >
          Повторить
        </button>
      </div>
      <template v-else>
        <section>
          <h3>Серверы</h3>
          <p
            v-if="!servers.length"
            class="panel-empty"
          >
            Серверы не настроены
          </p>
          <div
            v-for="server in servers"
            :key="server.id"
            class="server-row"
          >
            <span
              class="server-status-dot"
              :class="server.status"
            />
            <span>{{ server.id }}</span>
            <span class="server-status-text">{{ server.status === 'ready' ? 'Готов' : 'Ошибка' }}</span>
          </div>
        </section>
        <section>
          <h3>Функции <span class="panel-count">{{ tools.length }}</span></h3>
          <p
            v-if="!tools.length"
            class="panel-empty"
          >
            Подключённые функции появятся здесь.
          </p>
          <div
            v-for="tool in tools"
            :key="tool.name"
            class="catalog-tool"
          >
            <div class="catalog-tool-name">
              {{ tool.name }}
            </div>
            <p>{{ tool.description || 'Без описания' }}</p>
            <span>{{ tool.source.serverId }}</span>
          </div>
        </section>
      </template>
    </div>
    <button
      class="panel-refresh"
      type="button"
      :disabled="loading"
      @click="emit('refresh')"
    >
      Обновить список
    </button>
  </aside>
</template>
