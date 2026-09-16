<script setup lang="ts">
import type { Chat } from "../api/types.js";

const props = defineProps<{
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
    <div class="sidebar-header">Agenter</div>
    <button
      class="new-chat-button"
      type="button"
      @click="emit('newChat')"
    >
      + New Chat
    </button>
    <ul class="chat-list">
      <li
        v-for="chat in props.chats"
        :key="chat.id"
        :class="{ active: chat.id === props.activeChatId }"
        class="chat-list-item"
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
          aria-label="Delete chat"
          @click="emit('deleteChat', chat.id)"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </button>
      </li>
    </ul>
  </aside>
</template>
