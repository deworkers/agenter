<script setup lang="ts">
import { computed } from "vue";
import type { McpServerSummary, SkillSummary } from "../api/types.js";
const props = defineProps<{ servers: McpServerSummary[]; activeServerIds: string[]; skills: SkillSummary[]; selectedSkillId: string; busy?: boolean; loading?: boolean; error?: string | null }>();
const emit = defineEmits<{ toggleServer: [id: string]; toggleSkill: [id: string] }>();
const skills = computed(() => props.skills.filter(skill => skill.enabled !== false));
const count = computed(() => props.activeServerIds.length + (props.selectedSkillId ? 1 : 0));
</script>

<template>
  <details
    class="sidebar-tools"
    open
  >
    <summary>Инструменты <span class="panel-count">{{ count }}</span></summary>
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
      <h3>Навыки</h3>
      <p
        v-if="!skills.length && !loading"
        class="sidebar-tools-hint"
      >
        Нет включённых навыков
      </p>
      <label
        v-for="skill in skills"
        :key="skill.id"
        class="capability-switch"
      >
        <span :title="skill.description">{{ skill.name }}</span>
        <input
          type="checkbox"
          role="switch"
          :aria-label="`Навык ${skill.name}`"
          :checked="selectedSkillId === skill.id"
          :disabled="busy"
          @change="emit('toggleSkill', skill.id)"
        >
      </label>
      <h3>MCP-сервисы</h3>
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
        <span>{{ server.id }}<small v-if="server.status !== 'ready'">недоступен</small></span>
        <input
          type="checkbox"
          role="switch"
          :aria-label="`MCP ${server.id}`"
          :checked="activeServerIds.includes(server.id)"
          :disabled="busy || server.status !== 'ready'"
          @change="emit('toggleServer', server.id)"
        >
      </label>
    </div>
  </details>
</template>
