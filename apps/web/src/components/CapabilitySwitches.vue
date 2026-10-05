<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { McpServerSummary, McpToolSummary, SkillSummary } from "../api/types.js";
import { summarizeActiveMcp } from "./capabilitySummary.js";
const props = defineProps<{ servers: McpServerSummary[]; tools: McpToolSummary[]; activeServerIds: string[]; manualServerIds: string[]; automaticServerIds: string[]; skills: SkillSummary[]; selectedSkillId: string; busy?: boolean; loading?: boolean; error?: string | null }>();
const emit = defineEmits<{ toggleServer: [id: string]; toggleSkill: [id: string]; settingsMcp: [] }>();
const skills = computed(() => props.skills.filter(skill => skill.enabled !== false));
const selectedSkill = computed(() => skills.value.find((skill) => skill.id === props.selectedSkillId));
const missingServers = computed(() => (selectedSkill.value?.mcpServers ?? []).filter((id) => !props.activeServerIds.includes(id)));
const summary = computed(() => summarizeActiveMcp(props.servers, props.tools, props.activeServerIds));
const sourceLabel = (id: string): string => props.manualServerIds.includes(id)
  ? "Выбран вручную"
  : props.automaticServerIds.includes(id) ? "Подключён навыком" : "";
const toolsPanel = ref<HTMLDetailsElement | null>(null);
const toolsPanelPreferenceKey = "agenter:sidebar:capabilities-open";

onMounted(() => {
  try {
    const preference = window.localStorage.getItem(toolsPanelPreferenceKey);
    if (preference !== null && toolsPanel.value) toolsPanel.value.open = preference === "true";
  } catch {
    // The panel still works when browser storage is unavailable.
  }
});

function savePanelPreference(event: Event): void {
  try {
    window.localStorage.setItem(toolsPanelPreferenceKey, String((event.currentTarget as HTMLDetailsElement).open));
  } catch {
    // Remembering this preference is optional.
  }
}
</script>

<template>
  <details
    ref="toolsPanel"
    class="sidebar-tools"
    @toggle="savePanelPreference"
  >
    <summary>
      <span class="sidebar-tools-title">
        Инструменты
        <svg
          class="sidebar-tools-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          aria-hidden="true"
        ><path d="m9 5 7 7-7 7" /></svg>
      </span>
      <span class="sidebar-tools-counts">
        <span>Серверы <strong>{{ summary.serverCount }}</strong></span>
        <span title="Безопасные функции выбранных MCP-серверов">
          <span class="visually-hidden">Безопасные </span>Функции <strong>{{ summary.safeToolCount }}</strong>
        </span>
      </span>
    </summary>
    <div class="sidebar-tools-content">
      <p
        v-if="loading"
        class="sidebar-tools-hint"
      >
        Загрузка…
      </p>
      <p
        v-if="error"
        class="sidebar-tools-hint"
        role="alert"
      >
        {{ error }}
      </p>
      <section class="capability-section">
        <h3>Навык <span>Один на сообщение</span></h3>
        <fieldset
          class="skill-choice-group"
          :disabled="busy || loading"
        >
          <legend class="visually-hidden">
            Выберите один навык для сообщения
          </legend>
          <label class="capability-switch">
            <input
              type="radio"
              name="selected-skill"
              aria-label="Без навыка"
              :checked="!selectedSkillId"
              @change="emit('toggleSkill', '')"
            >
            <span>Без навыка</span>
          </label>
          <label
            v-for="skill in skills"
            :key="skill.id"
            class="capability-switch"
          >
            <input
              type="radio"
              name="selected-skill"
              :aria-label="`Навык ${skill.name}`"
              :value="skill.id"
              :checked="selectedSkillId === skill.id"
              @change="emit('toggleSkill', skill.id)"
            >
            <span :title="skill.description">{{ skill.name }}</span>
          </label>
        </fieldset>
        <p
          v-if="!skills.length && !loading"
          class="sidebar-tools-hint"
        >
          Нет включённых навыков
        </p>
        <p
          v-if="missingServers.length"
          class="sidebar-tools-warning"
          role="status"
        >
          Для навыка не выбраны MCP: {{ missingServers.join(', ') }}.
          <button
            type="button"
            @click="emit('settingsMcp')"
          >
            Настроить MCP
          </button>
        </p>
      </section>
      <section class="capability-section">
        <h3>MCP-серверы</h3>
        <p
          v-if="!servers.length && !loading"
          class="sidebar-tools-hint"
        >
          Нет MCP-сервисов
        </p>
        <label
          v-for="server in servers"
          :key="server.id"
          class="capability-switch"
        >
          <span>
            {{ server.id }}
            <small v-if="sourceLabel(server.id)">{{ sourceLabel(server.id) }}</small>
            <small v-else-if="server.status !== 'ready'">недоступен</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            :aria-label="`MCP ${server.id}`"
            :checked="activeServerIds.includes(server.id)"
            :disabled="busy || server.status !== 'ready'"
            @change="emit('toggleServer', server.id)"
          >
        </label>
      </section>
    </div>
  </details>
</template>
