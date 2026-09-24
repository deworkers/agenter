<script setup lang="ts">
import { computed } from "vue";
import type { McpServerSummary, McpToolSummary, SkillSummary } from "../api/types.js";

const props = defineProps<{
  servers: McpServerSummary[];
  tools: McpToolSummary[];
  activeServerIds: string[];
  skills: SkillSummary[];
  selectedSkillId: string;
  skillsLoading: boolean;
  skillsError: string | null;
  isStreaming: boolean;
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  close: [];
  refresh: [];
  toggle: [id: string];
  toggleSkill: [id: string];
  retrySkills: [];
  addSkill: [];
}>();
const activeTools = computed(() => props.tools.filter((tool) => props.activeServerIds.includes(tool.source.serverId)));
const visibleSkills = computed(() => props.skillsLoading || props.skillsError ? [] : props.skills);
function toolCount(serverId: string): number {
  return props.tools.filter((tool) => tool.source.serverId === serverId).length;
}
</script>

<template>
  <aside
    class="mcp-panel"
    aria-label="Инструменты и навыки"
  >
    <div class="mcp-panel-header">
      <div>
        <h2>Инструменты</h2>
        <p>Выберите возможности для следующих сообщений</p>
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
      <section>
        <div class="panel-section-heading">
          <h3>Навыки</h3>
          <button
            class="panel-add-skill"
            type="button"
            @click="emit('addSkill')"
          >
            <span aria-hidden="true">+</span> Добавить
          </button>
        </div>
        <p class="panel-section-hint">
          Можно выбрать один навык. Повторное нажатие отключит его.
        </p>
        <p
          v-if="skillsLoading"
          class="panel-empty"
        >
          Загрузка навыков…
        </p>
        <div
          v-else-if="skillsError"
          class="panel-empty"
          role="alert"
        >
          <p>Не удалось загрузить навыки: {{ skillsError }}</p>
          <button
            class="text-button"
            type="button"
            @click="emit('retrySkills')"
          >
            Повторить
          </button>
        </div>
        <p
          v-else-if="!skills.length"
          class="panel-empty"
        >
          Навыков пока нет.
        </p>
        <label
          v-for="skill in visibleSkills"
          :key="skill.id"
          class="server-row"
          :class="{ 'server-row-active': selectedSkillId === skill.id, 'server-row-disabled': isStreaming }"
        >
          <span
            class="skill-row-icon"
            aria-hidden="true"
          >✳</span>
          <span class="server-row-copy">
            <strong>{{ skill.name }}</strong>
            <small>{{ skill.description || skill.id }}</small>
          </span>
          <input
            class="mcp-switch-input"
            type="checkbox"
            :checked="selectedSkillId === skill.id"
            :disabled="isStreaming"
            :aria-label="`Навык ${skill.name}`"
            @change="emit('toggleSkill', skill.id)"
          >
          <span
            class="mcp-switch-track"
            aria-hidden="true"
          />
        </label>
      </section>
      <section>
        <h3>MCP-серверы</h3>
        <p
          v-if="loading"
          class="panel-empty"
        >
          Загрузка серверов…
        </p>
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
          <p class="mcp-selection-note">
            {{ activeServerIds.length ? `Активно серверов: ${activeServerIds.length} · функций: ${activeTools.length}` : 'Все MCP выключены. Их функции не передаются модели.' }}
          </p>
          <p
            v-if="!servers.length"
            class="panel-empty"
          >
            Серверы не настроены
          </p>
          <label
            v-for="server in servers"
            :key="server.id"
            class="server-row"
            :class="{ 'server-row-active': activeServerIds.includes(server.id), 'server-row-disabled': server.status !== 'ready' }"
          >
            <span
              class="server-status-dot"
              :class="server.status"
            />
            <span class="server-row-copy">
              <strong>{{ server.id }}</strong>
              <small>{{ server.status === 'ready' ? `${toolCount(server.id)} функций` : 'Недоступен' }}</small>
            </span>
            <input
              class="mcp-switch-input"
              type="checkbox"
              :checked="activeServerIds.includes(server.id)"
              :disabled="server.status !== 'ready'"
              :aria-label="`MCP-сервер ${server.id}`"
              @change="emit('toggle', server.id)"
            >
            <span
              class="mcp-switch-track"
              aria-hidden="true"
            />
          </label>
        </template>
      </section>
      <details
        v-if="activeTools.length"
        class="mcp-tool-list"
      >
        <summary>Функции, доступные модели <span class="panel-count">{{ activeTools.length }}</span></summary>
        <div
          v-for="tool in activeTools"
          :key="tool.name"
          class="catalog-tool"
        >
          <div class="catalog-tool-name">
            {{ tool.name }}
          </div>
          <p>{{ tool.description || 'Без описания' }}</p>
          <span>{{ tool.source.serverId }}</span>
        </div>
      </details>
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
