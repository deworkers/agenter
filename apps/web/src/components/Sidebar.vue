<script setup lang="ts">
import type { Chat, McpServerSummary, SkillSummary } from "../api/types.js";
import CapabilitySwitches from "./CapabilitySwitches.vue";

defineProps<{
  chats: Chat[];
  activeChatId: string | null;
  mobileOpen?: boolean;
  busy?: boolean;
  servers: McpServerSummary[];
  activeServerIds: string[];
  skills: SkillSummary[];
  selectedSkillId: string;
  capabilitiesLoading: boolean;
  capabilitiesError: string | null;
}>();

const emit = defineEmits<{
  newChat: [];
  home: [];
  selectChat: [id: string];
  deleteChat: [id: string];
  close: [];
  settings: [];
  settingsMcp: [];
  toggleServer: [id: string];
  toggleSkill: [id: string];
}>();
</script>

<template>
  <aside
    class="sidebar"
    :class="{'mobile-open':mobileOpen}"
  >
    <div class="sidebar-header">
      <div class="brand-mark">
        A
      </div>
      <span>Agenter</span>
      <button
        class="icon-button mobile-only"
        type="button"
        aria-label="Закрыть историю"
        @click="emit('close')"
      >
        ×
      </button>
    </div>
    <button
      class="new-chat-button"
      :disabled="busy"
      type="button"
      @click="emit('newChat')"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      Новый диалог
    </button>
    <div class="sidebar-section-title">
      Рабочее пространство
    </div>
    <button
      type="button"
      class="workspace-nav"
      :aria-current="!activeChatId ? 'page' : undefined"
      :disabled="busy"
      @click="emit('home')"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
      ><path d="M4 4h16v12H8l-4 4V4Z" /><path d="M8 8h8M8 12h5" /></svg>
      Чат
    </button>
    <div class="sidebar-section-title">
      Недавнее
    </div>
    <div
      v-if="!chats.length"
      class="sidebar-empty"
    >
      Ваши диалоги появятся здесь.
    </div>
    <ul
      v-else
      class="chat-list"
    >
      <li
        v-for="chat in chats"
        :key="chat.id"
        class="chat-list-item"
        :class="{ active: chat.id === activeChatId }"
      >
        <button
          type="button"
          class="chat-title"
          :disabled="busy"
          @click="emit('selectChat', chat.id)"
        >
          {{ chat.title }}
        </button>
        <button
          type="button"
          class="delete-button"
          :disabled="busy"
          :aria-label="`Удалить чат ${chat.title}`"
          @click="emit('deleteChat', chat.id)"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </button>
      </li>
    </ul>
    <CapabilitySwitches
      :servers="servers"
      :active-server-ids="activeServerIds"
      :skills="skills"
      :selected-skill-id="selectedSkillId"
      :busy="busy"
      :loading="capabilitiesLoading"
      :error="capabilitiesError"
      @toggle-server="emit('toggleServer', $event)"
      @toggle-skill="emit('toggleSkill', $event)"
      @settings-mcp="emit('settingsMcp')"
    />
    <button
      class="settings-open-button"
      type="button"
      @click="emit('settings')"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
      ><path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3H9Z" /><circle
        cx="12"
        cy="12"
        r="3"
      /></svg>
      Настройки
    </button>
    <div class="sidebar-footer">
      <span
        class="workspace-avatar"
        aria-hidden="true"
      >A</span>
      <div><strong>Личное пространство</strong><span><span class="sidebar-footer-dot" /> Локальный Agenter</span></div>
    </div>
  </aside>
</template>
