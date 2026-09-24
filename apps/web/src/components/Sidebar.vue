<script setup lang="ts">
import type { Chat } from "../api/types.js";

defineProps<{
  chats: Chat[];
  activeChatId: string | null;
}>();

const emit = defineEmits<{
  newChat: [];
  selectChat: [id: string];
  deleteChat: [id: string];
}>();
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="brand-mark">
        ✳
      </div>
      <span>Agenter</span>
    </div>
    <button
      class="new-chat-button"
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
          @click="emit('selectChat', chat.id)"
        >
          {{ chat.title }}
        </button>
        <button
          type="button"
          class="delete-button"
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
    <div class="sidebar-footer">
      <span class="sidebar-footer-dot" /> Локальное рабочее пространство
    </div>
  </aside>
</template>
