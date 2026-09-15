// apps/web/src/composables/useChats.ts
import { ref } from "vue";
import * as client from "../api/client.js";
import type { Chat, StoredMessage } from "../api/types.js";

export function useChats() {
  const chats = ref<Chat[]>([]);
  const activeChat = ref<Chat | null>(null);
  const messages = ref<StoredMessage[]>([]);
  const isStreaming = ref(false);
  const currentModelLabel = ref<string | null>(null);

  async function refreshChats(): Promise<void> {
    chats.value = await client.listChats();
  }

  async function openChat(chatId: string): Promise<void> {
    const result = await client.getChat(chatId);
    activeChat.value = result.chat;
    messages.value = result.messages;
  }

  async function newChat(): Promise<void> {
    const chat = await client.createChat();
    await refreshChats();
    await openChat(chat.id);
  }

  async function removeChat(chatId: string): Promise<void> {
    await client.deleteChat(chatId);
    if (activeChat.value?.id === chatId) {
      activeChat.value = null;
      messages.value = [];
    }
    await refreshChats();
  }

  async function sendMessage(content: string): Promise<void> {
    if (!activeChat.value) return;
    const chatId = activeChat.value.id;

    messages.value.push({
      id: `local-${Date.now()}`,
      chatId,
      role: "user",
      content,
      provider: null,
      model: null,
      createdAt: new Date().toISOString(),
    });

    isStreaming.value = true;
    let assistantText = "";
    let provider: string | null = null;
    let model: string | null = null;

    try {
      for await (const event of client.sendMessage(chatId, content)) {
        if (event.type === "run.started") {
          provider = event.provider;
          model = event.model;
          currentModelLabel.value = event.model;
        } else if (event.type === "text.delta") {
          assistantText += event.text;
        } else if (event.type === "run.error") {
          assistantText = `⚠ ${event.message}`;
        }
      }
    } finally {
      isStreaming.value = false;
    }

    messages.value.push({
      id: `local-${Date.now()}-assistant`,
      chatId,
      role: "assistant",
      content: assistantText,
      provider,
      model,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    chats,
    activeChat,
    messages,
    isStreaming,
    currentModelLabel,
    refreshChats,
    openChat,
    newChat,
    removeChat,
    sendMessage,
  };
}
