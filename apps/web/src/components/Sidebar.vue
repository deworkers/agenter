<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { Chat, McpServerSummary, McpToolSummary, SkillSummary } from "../api/types.js";
import { useModalFocus } from "../composables/useModalFocus.js";
import CapabilitySwitches from "./CapabilitySwitches.vue";
import { groupChats } from "./chatList.js";

const props = defineProps<{
  login: string;
  loggingOut: boolean;
  chats: Chat[];
  activeChatId: string | null;
  mobileOpen?: boolean;
  busy?: boolean;
  activeRunChatId?: string | null;
  servers: McpServerSummary[];
  tools: McpToolSummary[];
  activeServerIds: string[];
  manualServerIds: string[];
  automaticServerIds: string[];
  skills: SkillSummary[];
  selectedSkillId: string;
  capabilitiesLoading: boolean;
  capabilitiesError: string | null;
}>();

const searchQuery = ref("");
const chatGroups = computed(() => groupChats(props.chats, searchQuery.value));
const renameDialog = ref<HTMLDialogElement | null>(null);
const renameInput = ref<HTMLInputElement | null>(null);
const chatBeingRenamed = ref<Chat | null>(null);
const renameTitle = ref("");
const mobileViewport = ref(false);
const mobileDrawerElement = ref<HTMLElement | null>(null);
const mobileDrawerOpen = computed(() => mobileViewport.value && props.mobileOpen === true);
useModalFocus(mobileDrawerElement, mobileDrawerOpen);
let mobileMediaQuery: MediaQueryList | null = null;
function updateMobileViewport(): void {
  mobileViewport.value = mobileMediaQuery?.matches ?? false;
}

const emit = defineEmits<{
  logout: [];
  newChat: [];
  selectChat: [id: string];
  deleteChat: [id: string];
  close: [];
  settings: [];
  settingsMcp: [];
  toggleServer: [id: string];
  toggleSkill: [id: string];
  renameChat: [id: string, title: string];
}>();

onMounted(() => {
  mobileMediaQuery = window.matchMedia("(max-width: 800px)");
  updateMobileViewport();
  mobileMediaQuery.addEventListener("change", updateMobileViewport);
});
onBeforeUnmount(() => mobileMediaQuery?.removeEventListener("change", updateMobileViewport));

function beginRename(chat: Chat): void {
  if (chatBeingRenamed.value?.id !== chat.id) renameTitle.value = chat.title;
  chatBeingRenamed.value = chat;
  renameDialog.value?.showModal();
  void nextTick(() => { renameInput.value?.select(); });
}

function saveRename(): void {
  const chat = chatBeingRenamed.value;
  const title = renameTitle.value.trim();
  if (chat && title) emit("renameChat", chat.id, title);
  renameDialog.value?.close();
}

function positionChatMenu(event: Event): void {
  const menu = event.currentTarget as HTMLDetailsElement;
  if (!menu.open) return;
  const trigger = menu.querySelector("summary");
  if (!trigger) return;
  const bounds = trigger.getBoundingClientRect();
  const menuHeight = 86;
  const menuWidth = 160;
  const opensUp = bounds.bottom + menuHeight > window.innerHeight - 8;
  const top = opensUp ? bounds.top - menuHeight - 2 : bounds.bottom + 2;
  const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, bounds.right - menuWidth));
  menu.classList.toggle("opens-up", opensUp);
  menu.style.setProperty("--chat-menu-top", `${Math.max(8, top)}px`);
  menu.style.setProperty("--chat-menu-left", `${left}px`);
}

function cancelRename(): void {
  chatBeingRenamed.value = null;
  renameTitle.value = "";
  renameDialog.value?.close();
}
</script>

<template>
  <aside
    ref="mobileDrawerElement"
    class="sidebar"
    :class="{'mobile-open':mobileOpen}"
    :role="mobileDrawerOpen ? 'dialog' : undefined"
    :aria-modal="mobileDrawerOpen ? 'true' : undefined"
    :aria-label="mobileDrawerOpen ? 'История и возможности' : undefined"
    :inert="mobileViewport && !mobileDrawerOpen"
    tabindex="-1"
    @keydown.esc="mobileDrawerOpen && emit('close')"
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
    <div class="chat-search">
      <label for="chat-search-input">История</label>
      <div class="chat-search-field">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        ><circle
          cx="10.8"
          cy="10.8"
          r="6.8"
        /><path d="m16 16 5 5" /></svg>
        <input
          id="chat-search-input"
          v-model="searchQuery"
          type="search"
          placeholder="Поиск чатов"
          autocomplete="off"
        >
        <button
          v-if="searchQuery"
          type="button"
          aria-label="Очистить поиск"
          @click="searchQuery = ''"
        >
          ×
        </button>
      </div>
    </div>
    <div
      v-if="!chats.length"
      class="sidebar-empty"
    >
      Ваши диалоги появятся здесь.
    </div>
    <div
      v-else-if="!chatGroups.length"
      class="sidebar-empty"
    >
      <span>Чаты не найдены.</span>
      <button
        type="button"
        class="clear-chat-search"
        @click="searchQuery = ''"
      >
        Очистить поиск
      </button>
    </div>
    <div
      v-else
      class="chat-list"
    >
      <section
        v-for="group in chatGroups"
        :key="group.label"
        class="chat-group"
      >
        <h2 class="sidebar-section-title">
          {{ group.label }}
        </h2>
        <ul>
          <li
            v-for="chat in group.chats"
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
            <details
              class="chat-actions-menu"
              @toggle="positionChatMenu"
            >
              <summary
                class="chat-actions-trigger"
                :aria-label="`Действия чата ${chat.title}`"
                :aria-disabled="busy || chat.id === activeRunChatId"
                @click="(busy || chat.id === activeRunChatId) && $event.preventDefault()"
              >
                <span aria-hidden="true">⋯</span>
              </summary>
              <div class="chat-actions-menu-content">
                <button
                  type="button"
                  :disabled="busy"
                  @click="beginRename(chat)"
                >
                  Переименовать
                </button>
                <button
                  type="button"
                  class="danger"
                  :disabled="busy || chat.id === activeRunChatId"
                  @click="emit('deleteChat', chat.id)"
                >
                  Удалить
                </button>
              </div>
            </details>
          </li>
        </ul>
      </section>
    </div>
    <CapabilitySwitches
      :servers="servers"
      :tools="tools"
      :active-server-ids="activeServerIds"
      :manual-server-ids="manualServerIds"
      :automatic-server-ids="automaticServerIds"
      :skills="skills"
      :selected-skill-id="selectedSkillId"
      :busy="busy"
      :loading="capabilitiesLoading"
      :error="capabilitiesError"
      @toggle-server="emit('toggleServer', $event)"
      @toggle-skill="emit('toggleSkill', $event)"
      @settings-mcp="emit('settingsMcp')"
    />
    <dialog
      ref="renameDialog"
      class="rename-chat-dialog"
      aria-labelledby="rename-chat-title"
      @cancel="cancelRename"
    >
      <form @submit.prevent="saveRename">
        <h2 id="rename-chat-title">
          Переименовать чат
        </h2>
        <label for="rename-chat-input">Название</label>
        <input
          id="rename-chat-input"
          ref="renameInput"
          v-model="renameTitle"
          type="text"
          maxlength="120"
          required
          autocomplete="off"
        >
        <div class="rename-chat-actions">
          <button
            type="button"
            class="secondary-button"
            @click="cancelRename"
          >
            Отмена
          </button>
          <button
            type="submit"
            class="primary-button"
            :disabled="!renameTitle.trim()"
          >
            Сохранить
          </button>
        </div>
      </form>
    </dialog>
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
      <div><strong>{{ login }}</strong><span><span class="sidebar-footer-dot" /> Личное окружение</span></div>
      <button
        class="logout-button"
        type="button"
        :disabled="loggingOut"
        @click="emit('logout')"
      >
        Выйти
      </button>
    </div>
  </aside>
</template>
