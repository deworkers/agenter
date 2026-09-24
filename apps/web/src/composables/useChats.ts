import { ref } from "vue";
import * as client from "../api/client.js";
import type { Chat, DisplayMessage, SendMessageOptions } from "../api/types.js";

export function useChats() {
  const chats = ref<Chat[]>([]);
  const activeChat = ref<Chat | null>(null);
  const messages = ref<DisplayMessage[]>([]);
  const isStreaming = ref(false);

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

  async function sendMessage(content: string, options: SendMessageOptions = {}): Promise<void> {
    if (!activeChat.value || isStreaming.value) return;
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

    const assistantMessage: DisplayMessage = {
      id: `local-${Date.now()}-assistant`,
      chatId,
      role: "assistant",
      content: "",
      provider: null,
      model: null,
      createdAt: new Date().toISOString(),
      tools: [],
    };
    messages.value.push(assistantMessage);
    const assistant = messages.value.at(-1)!;
    isStreaming.value = true;
    const startedAt = Date.now();

    try {
      for await (const event of client.sendMessage(chatId, content, options)) {
        if (event.type === "run.started") {
          assistant.provider = event.provider;
          assistant.model = event.model;
        } else if (event.type === "text.delta") {
          assistant.content += event.text;
        } else if (event.type === "tool.started") {
          assistant.tools?.push({ name: event.tool, arguments: event.arguments, status: "running" });
        } else if (event.type === "tool.completed") {
          const tool = assistant.tools?.findLast((item) => item.name === event.tool && item.status === "running");
          if (tool) {
            tool.result = event.result;
            tool.status = "completed";
          }
        } else if (event.type === "run.error") {
          assistant.error = event.message;
          for (const tool of assistant.tools ?? []) {
            if (tool.status === "running") tool.status = "error";
          }
        }
      }
    } catch (cause) {
      assistant.error = cause instanceof Error ? cause.message : String(cause);
      for (const tool of assistant.tools ?? []) {
        if (tool.status === "running") tool.status = "error";
      }
    } finally {
      assistant.durationMs = Date.now() - startedAt;
      isStreaming.value = false;
    }
  }

  return { chats, activeChat, messages, isStreaming, refreshChats, openChat, newChat, removeChat, sendMessage };
}
