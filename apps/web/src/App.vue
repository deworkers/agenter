<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { NewSkillInput, TextAttachment, ResponseFormat } from "./api/types.js";
import { validateAttachments, validateResponseFormat } from "@agenter/agent-core";
import { useChats } from "./composables/useChats.js";
import { useProviders } from "./composables/useProviders.js";
import { useSkills } from "./composables/useSkills.js";
import { useMcp } from "./composables/useMcp.js";
import Sidebar from "./components/Sidebar.vue";
import ChatView from "./components/ChatView.vue";
import SkillDialog from "./components/SkillDialog.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import { useContext } from "./composables/useContext.js";
import { parseChatCommand } from "./composables/chatCommands.js";

const { chats, activeChat, messages, isStreaming, isCompacting, contextRevision, compact, refreshChats, newChat, showHome, openChat, removeChat, sendMessage, stopGeneration } = useChats();
const busy = computed(() => isStreaming.value || isCompacting.value);
const { providers, defaultProviderId, selectedProviderId, isLoading: providersLoading, error: providersError, refreshProviders } = useProviders();
const { skills, selectedSkillId, isLoading: skillsLoading, error: skillsError, isAdding: skillAdding, addError: skillAddError, refreshSkills, addSkill, toggleSkill } = useSkills();
const { servers, tools, activeServerIds, manualServerIds, automaticServerIds, isLoading: mcpLoading, error: mcpError, refreshMcp, toggleServer, restoreSelection, applySkillServers } = useMcp();
const skillDialogOpen = ref(false);
const settingsOpen = ref(false);
const settingsSection = ref<"models" | "mcp">("models");
const mobileMenu = ref(false);
const draft = ref("");
const attachments = ref<TextAttachment[]>([]);
const responseFormat = ref<ResponseFormat>("text");
const historyLimit = ref<number | undefined>(undefined);
const chatError = ref("");
const commandNotice = ref("");
const chatView = ref<InstanceType<typeof ChatView> | null>(null);
const sendOptions = computed(() => ({
  ...(selectedProviderId.value === "auto" ? { mode: "auto" as const } : { mode: "manual" as const, providerId: selectedProviderId.value }),
  ...(selectedSkillId.value ? { skillId: selectedSkillId.value } : {}),
  mcpServerIds: [...activeServerIds.value], historyLimit: historyLimit.value,
  ...(attachments.value.length ? { attachments: attachments.value } : {}),
  ...(responseFormat.value !== "text" ? { responseFormat: responseFormat.value } : {}),
}));
const { budget: previewBudget, error: contextError, updating: contextUpdating } = useContext(() => ({ chatId: activeChat.value?.id ?? "", content: draft.value, options: sendOptions.value, revision: messages.value.length + contextRevision.value, streaming: busy.value }));
const budget = computed(() => isStreaming.value ? messages.value.findLast((item) => item.role === "user")?.context?.budget ?? previewBudget.value : previewBudget.value);
function preferenceKey(): string { return `agenter:chat:${activeChat.value?.id ?? 'new'}`; }
let restoring = false;
watch([draft, attachments, responseFormat, selectedProviderId, selectedSkillId, manualServerIds, automaticServerIds, historyLimit], () => {
  if (restoring) return;
  try { localStorage.setItem(preferenceKey(), JSON.stringify({ draft: draft.value, attachments: attachments.value, responseFormat: responseFormat.value, providerId: selectedProviderId.value, skillId: selectedSkillId.value, serverIds: activeServerIds.value, manualServerIds: manualServerIds.value, automaticServerIds: automaticServerIds.value, historyLimit: historyLimit.value })); } catch { /* Storage may be unavailable. */ }
}, { deep: true, flush: "sync" });
async function selectChat(id: string): Promise<void> {
  if (busy.value) return;
  try {
    restoring = true;
    const saved = localStorage.getItem(`agenter:chat:${id}`);
    await openChat(id);
    if (activeChat.value?.id !== id) return;
    const value = saved ? JSON.parse(saved) as { draft?: string; attachments?: unknown; responseFormat?: unknown; providerId?: string; skillId?: string; serverIds?: string[]; manualServerIds?: string[]; automaticServerIds?: string[]; historyLimit?: number } : {};
    draft.value = typeof value.draft === "string" ? value.draft : "";
    try { attachments.value = validateAttachments(value.attachments); responseFormat.value = validateResponseFormat(value.responseFormat) ?? "text"; }
    catch { attachments.value = []; responseFormat.value = "text"; }
    selectedProviderId.value = value.providerId === "auto" || providers.value.some((item) => item.id === value.providerId) ? value.providerId! : "auto";
    selectedSkillId.value = skills.value.some((item) => item.id === value.skillId && item.enabled !== false) ? value.skillId! : "";
    const manual = Array.isArray(value.manualServerIds) ? value.manualServerIds : Array.isArray(value.serverIds) ? value.serverIds : [];
    restoreSelection(manual.filter((id): id is string => typeof id === "string"), Array.isArray(value.automaticServerIds) ? value.automaticServerIds.filter((id): id is string => typeof id === "string") : []);
    historyLimit.value = value.historyLimit === 0 || value.historyLimit === 20 ? value.historyLimit : undefined;
    mobileMenu.value = false; chatError.value = "";
  } catch { chatError.value = "Не удалось открыть чат"; }
  finally { restoring = false; }
}
watch(() => activeChat.value?.id, () => { if (!restoring) { draft.value = ""; attachments.value = []; responseFormat.value = "text"; } });
async function handleNewChat(): Promise<void> {
  if (busy.value) return;
  try { await newChat(); mobileMenu.value = false; chatError.value = ""; }
  catch { chatError.value = "Не удалось создать чат"; }
}
async function refreshSkillsAndBindings(): Promise<void> {
  const oldSkill = skills.value.find((item) => item.id === selectedSkillId.value);
  const oldLinks = JSON.stringify(oldSkill?.mcpServers ?? []);
  await refreshSkills();
  const newSkill = skills.value.find((item) => item.id === selectedSkillId.value);
  if (newSkill && oldLinks !== JSON.stringify(newSkill.mcpServers ?? [])) applySkillServers(newSkill.mcpServers ?? []);
}
async function reloadCatalogs(): Promise<void> { await Promise.all([refreshProviders(), refreshMcp()]); await refreshSkillsAndBindings(); }

function handleToggleSkill(id: string): void {
  toggleSkill(id);
  const selected = skills.value.find((item) => item.id === selectedSkillId.value);
  if (selected) applySkillServers(selected.mcpServers ?? []);
}
function openSettings(section: "models" | "mcp" = "models"): void { settingsSection.value = section; settingsOpen.value = true; }

onMounted(() => {
  void refreshChats().catch(() => { chatError.value = "Не удалось загрузить историю"; });
  void refreshProviders();
  void refreshSkills();
  void refreshMcp();
});
const viewport = window.visualViewport;
function resizeViewport(): void { document.documentElement.style.setProperty("--app-height", `${viewport?.height ?? window.innerHeight}px`); }
onMounted(() => { resizeViewport(); viewport?.addEventListener("resize", resizeViewport); window.addEventListener("resize", resizeViewport); });
onUnmounted(() => { viewport?.removeEventListener("resize", resizeViewport); window.removeEventListener("resize", resizeViewport); });

async function handleSend(content: string, files: TextAttachment[] = []): Promise<void> {
  commandNotice.value = "";
  const command = parseChatCommand(content);
  if (command) {
    if (busy.value) return;
    if (command.name === "new") { await handleNewChat(); return; }
    if (command.name === "model") {
      if (!command.argument) { await nextTick(); await chatView.value?.openModelPicker(); return; }
      const provider = providers.value.find(item => item.id === command.argument);
      if (command.argument !== "auto" && !provider) { commandNotice.value = "Модель не найдена. Используйте /model для выбора."; return; }
      selectedProviderId.value = command.argument;
      commandNotice.value = `Модель: ${provider?.label || provider?.id || 'Auto'}`;
      return;
    }
    if (command.name === "compact") { await handleCompact(); return; }
    commandNotice.value = "Команды: /model [ID или auto], /new, /compact"; return;
  }
  if (providersLoading.value || providersError.value || !selectedProviderId.value) return;
  const options = { ...sendOptions.value, attachments: files };
  try {
    if (!activeChat.value) { await newChat(); responseFormat.value = options.responseFormat ?? "text"; }
    await sendMessage(content, options);
  } catch { draft.value = content; attachments.value = files; chatError.value = "Не удалось отправить сообщение"; }
}

async function handleCompact(): Promise<void> {
  if (!activeChat.value || !messages.value.length) { commandNotice.value = "В чате пока нет истории для сжатия."; return; }
  commandNotice.value = "Создаём резюме диалога…";
  try {
    const result = await compact(sendOptions.value);
    if (result) { historyLimit.value = undefined; commandNotice.value = `Создано резюме: ≈${result.beforeTokens} → ≈${result.afterTokens} токенов истории. Полный диалог сохранён.`; }
  } catch (cause) { commandNotice.value = cause instanceof DOMException && cause.name === "AbortError" ? "Сжатие остановлено. Прежний контекст сохранён." : cause instanceof Error ? cause.message : "Не удалось сжать контекст."; }
}

async function handleDelete(id: string): Promise<void> {
  if (busy.value) return;
  if (!window.confirm("Удалить этот чат и его историю?")) return;
  try { await removeChat(id); } catch { chatError.value = "Не удалось удалить чат"; }
}

async function handleAddSkill(input: NewSkillInput): Promise<void> {
  if (await addSkill(input)) { skillDialogOpen.value = false; applySkillServers(input.mcpServers ?? []); }
}

function openSkillDialog(): void {
  skillAddError.value = null;
  skillDialogOpen.value = true;
}
</script>

<template>
  <div class="layout">
    <button
      v-if="mobileMenu"
      class="sidebar-backdrop"
      type="button"
      aria-label="Закрыть меню"
      @click="mobileMenu=false"
    />
    <Sidebar
      :chats="chats"
      :active-chat-id="activeChat?.id ?? null"
      :mobile-open="mobileMenu"
      :busy="busy"
      :servers="servers"
      :active-server-ids="activeServerIds"
      :skills="skills"
      :selected-skill-id="selectedSkillId"
      :capabilities-loading="skillsLoading || mcpLoading"
      :capabilities-error="skillsError || mcpError"
      @toggle-server="toggleServer"
      @toggle-skill="handleToggleSkill"
      @close="mobileMenu=false"
      @settings="openSettings(); mobileMenu=false"
      @settings-mcp="openSettings('mcp'); mobileMenu=false"
      @new-chat="handleNewChat"
      @home="showHome(); mobileMenu=false"
      @select-chat="selectChat"
      @delete-chat="handleDelete"
    />
    <ChatView
      ref="chatView"
      v-model:provider-id="selectedProviderId"
      v-model:draft="draft"
      v-model:attachments="attachments"
      v-model:response-format="responseFormat"
      v-model:history-limit="historyLimit"
      :messages="messages"
      :chats="chats"
      :is-streaming="busy"
      :active-chat="activeChat"
      :providers="providers"
      :default-provider-id="defaultProviderId"
      :providers-loading="providersLoading"
      :providers-error="providersError"
      :budget="budget"
      :context-error="contextError"
      :context-updating="contextUpdating"
      :command-notice="commandNotice"
      @retry-providers="refreshProviders"
      @select-chat="selectChat"
      @send="handleSend"
      @settings="openSettings()"
      @menu="mobileMenu=true"
      @stop="stopGeneration"
    />
    <div
      v-if="chatError"
      class="app-error"
      role="alert"
    >
      {{ chatError }} <button
        type="button"
        @click="chatError=''"
      >
        ×
      </button>
    </div>
    <SettingsDialog
      v-if="settingsOpen"
      :initial-section="settingsSection"
      :skills="skills"
      :tools="tools"
      :servers="servers"
      :mcp-loading="mcpLoading"
      @close="settingsOpen=false"
      @saved="reloadCatalogs"
      @skills-changed="refreshSkillsAndBindings"
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
