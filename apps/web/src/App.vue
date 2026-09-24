<script setup lang="ts">
import { onMounted } from "vue";
import { useChats } from "./composables/useChats.js";
import { useProviders } from "./composables/useProviders.js";
import { useSkills } from "./composables/useSkills.js";
import { useMcp } from "./composables/useMcp.js";
import Sidebar from "./components/Sidebar.vue";
import ChatView from "./components/ChatView.vue";

const { chats, activeChat, messages, isStreaming, refreshChats, newChat, openChat, removeChat, sendMessage } = useChats();
const { providers, defaultProviderId, selectedProviderId, isLoading: providersLoading, error: providersError, refreshProviders } = useProviders();
const { skills, selectedSkillId, isLoading: skillsLoading, error: skillsError, refreshSkills } = useSkills();
const { servers, tools, isLoading: mcpLoading, error: mcpError, refreshMcp } = useMcp();

onMounted(() => {
  void refreshChats();
  void refreshProviders();
  void refreshSkills();
  void refreshMcp();
});

async function handleSend(content: string): Promise<void> {
  if (providersLoading.value || providersError.value || !selectedProviderId.value) return;
  if (!activeChat.value) await newChat();
  await sendMessage(content, {
    ...(selectedProviderId.value === "auto"
      ? { mode: "auto" as const }
      : { mode: "manual" as const, providerId: selectedProviderId.value }),
    ...(selectedSkillId.value ? { skillId: selectedSkillId.value } : {}),
  });
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
      v-model:skill-id="selectedSkillId"
      :messages="messages"
      :is-streaming="isStreaming"
      :active-chat="activeChat"
      :providers="providers"
      :default-provider-id="defaultProviderId"
      :providers-loading="providersLoading"
      :providers-error="providersError"
      :skills="skills"
      :skills-loading="skillsLoading"
      :skills-error="skillsError"
      :mcp-servers="servers"
      :mcp-tools="tools"
      :mcp-loading="mcpLoading"
      :mcp-error="mcpError"
      @retry-providers="refreshProviders"
      @retry-skills="refreshSkills"
      @retry-mcp="refreshMcp"
      @new-chat="newChat"
      @send="handleSend"
    />
  </div>
</template>
