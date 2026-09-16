<script setup lang="ts">
import { onMounted } from "vue";
import { useChats } from "./composables/useChats.js";
import { useProviders } from "./composables/useProviders.js";
import Sidebar from "./components/Sidebar.vue";
import ChatView from "./components/ChatView.vue";

const { chats, activeChat, messages, isStreaming, refreshChats, newChat, openChat, removeChat, sendMessage } = useChats();
const { providers, defaultProviderId, selectedProviderId, isLoading: providersLoading, error: providersError, refreshProviders } = useProviders();

onMounted(() => {
  void refreshChats();
  void refreshProviders();
});

async function handleSend(content: string): Promise<void> {
  if (providersLoading.value || providersError.value || !selectedProviderId.value) return;
  await sendMessage(content, selectedProviderId.value);
}

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
      v-model:provider-id="selectedProviderId"
      :messages="messages"
      :is-streaming="isStreaming"
      :has-active-chat="activeChat !== null"
      :providers="providers"
      :default-provider-id="defaultProviderId"
      :providers-loading="providersLoading"
      :providers-error="providersError"
      @retry-providers="refreshProviders"
      @send="handleSend"
    />
  </div>
</template>
