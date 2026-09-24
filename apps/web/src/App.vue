<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { NewSkillInput } from "./api/types.js";
import { useChats } from "./composables/useChats.js";
import { useProviders } from "./composables/useProviders.js";
import { useSkills } from "./composables/useSkills.js";
import { useMcp } from "./composables/useMcp.js";
import Sidebar from "./components/Sidebar.vue";
import ChatView from "./components/ChatView.vue";
import SkillDialog from "./components/SkillDialog.vue";

const { chats, activeChat, messages, isStreaming, refreshChats, newChat, openChat, removeChat, sendMessage } = useChats();
const { providers, defaultProviderId, selectedProviderId, isLoading: providersLoading, error: providersError, refreshProviders } = useProviders();
const { skills, selectedSkillId, isLoading: skillsLoading, error: skillsError, isAdding: skillAdding, addError: skillAddError, refreshSkills, addSkill, toggleSkill } = useSkills();
const { servers, tools, activeServerIds, isLoading: mcpLoading, error: mcpError, refreshMcp, toggleServer } = useMcp();
const skillDialogOpen = ref(false);

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
    mcpServerIds: [...activeServerIds.value],
  });
}

async function handleDelete(id: string): Promise<void> {
  await removeChat(id);
}

async function handleAddSkill(input: NewSkillInput): Promise<void> {
  if (await addSkill(input)) skillDialogOpen.value = false;
}

function openSkillDialog(): void {
  skillAddError.value = null;
  skillDialogOpen.value = true;
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
      :active-chat="activeChat"
      :providers="providers"
      :default-provider-id="defaultProviderId"
      :providers-loading="providersLoading"
      :providers-error="providersError"
      :skills="skills"
      :selected-skill-id="selectedSkillId"
      :skills-loading="skillsLoading"
      :skills-error="skillsError"
      :mcp-servers="servers"
      :mcp-tools="tools"
      :active-mcp-server-ids="activeServerIds"
      :mcp-loading="mcpLoading"
      :mcp-error="mcpError"
      @retry-providers="refreshProviders"
      @retry-skills="refreshSkills"
      @retry-mcp="refreshMcp"
      @toggle-mcp="toggleServer"
      @toggle-skill="toggleSkill"
      @new-chat="newChat"
      @send="handleSend"
      @add-skill="openSkillDialog"
    />
    <SkillDialog
      v-if="skillDialogOpen"
      :saving="skillAdding"
      :error="skillAddError"
      @close="skillDialogOpen = false"
      @create="handleAddSkill"
    />
  </div>
</template>
