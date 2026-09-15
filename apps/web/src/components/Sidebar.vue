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
          ×
        </button>
      </li>
    </ul>
  </aside>
</template>
