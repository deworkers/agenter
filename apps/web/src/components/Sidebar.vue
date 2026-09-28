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
  selectChat: [id: string];
  deleteChat: [id: string];
  close: [];
  settings: [];
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
        ✳
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
        <path d="M12 20H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
        <path d="m14 6 4 4" /><path d="m10 14 9-9a2.1 2.1 0 0 1 3 3l-9 9-4 1z" />
      </svg>
      Новый чат
    </button>
    <div class="sidebar-section-title">
      История чатов
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
    />
    <div class="sidebar-footer">
      <span class="sidebar-footer-dot" /> Локальное рабочее пространство
    </div>
    <button
      class="settings-open-button"
      type="button"
      @click="emit('settings')"
    >
      ⚙ Настройки
    </button>
  </aside>
</template>
