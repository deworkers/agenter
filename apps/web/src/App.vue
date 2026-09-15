<script setup lang="ts">
import { onMounted } from "vue";
import { useChats } from "./composables/useChats.js";
import Sidebar from "./components/Sidebar.vue";
import ChatView from "./components/ChatView.vue";

const { chats, activeChat, messages, isStreaming, refreshChats, newChat, openChat, removeChat, sendMessage } = useChats();

onMounted(() => {
  void refreshChats();
});

async function handleDelete(id: string): Promise<void> {
  await removeChat(id);
}
</script>

<template>
  <div class="layout">
    <Sidebar
      :chats="chats"
      :active-chat-id="activeChat?.id ?? null"
      @new-chat="newChat"
      @select-chat="openChat"
      @delete-chat="handleDelete"
    />
    <ChatView
      :messages="messages"
      :is-streaming="isStreaming"
      :has-active-chat="activeChat !== null"
      @send="sendMessage"
    />
  </div>
</template>
