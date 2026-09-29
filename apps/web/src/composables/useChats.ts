import { ref } from "vue";
import * as client from "../api/client.js";
import type { Chat, DisplayMessage, SendMessageOptions } from "../api/types.js";

export function useChats() {
  const chats = ref<Chat[]>([]);
  const activeChat = ref<Chat | null>(null);
  const messages = ref<DisplayMessage[]>([]);
  const isStreaming = ref(false);
  const isCompacting = ref(false);
  const contextRevision = ref(0);
  let controller: AbortController | undefined;
  let openSequence = 0;
  function stopGeneration(): void { controller?.abort(); }

  async function compact(options: SendMessageOptions = {}) {
    if (!activeChat.value || isStreaming.value || isCompacting.value) return undefined;
    isCompacting.value = true; controller = new AbortController();
    try {
      const result = await client.compactChat(activeChat.value.id, options, controller.signal);
      contextRevision.value++; return result;
    } finally { isCompacting.value = false; controller = undefined; }
  }

  async function refreshChats(): Promise<void> {
    chats.value = await client.listChats();
  }

  async function openChat(chatId: string): Promise<void> {
    const sequence = ++openSequence;
    const result = await client.getChat(chatId);
    if (sequence !== openSequence) return;
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
    if (!activeChat.value || isStreaming.value || isCompacting.value) return;
    const chatId = activeChat.value.id;
    const title = content.trim().replace(/\s+/g, " ") || options.attachments?.[0]?.name || "Вложения";
    activeChat.value.title = title;
    const listed = chats.value.find((chat) => chat.id === chatId);
    if (listed) {
      listed.title = title;
      chats.value = [listed, ...chats.value.filter((chat) => chat.id !== chatId)];
    }
    messages.value.push({
      id: `local-${Date.now()}`,
      chatId,
      role: "user",
      content,
      ...(options.attachments?.length ? { attachments: options.attachments.map(item => ({ ...item })) } : {}),
      provider: null,
      model: null,
      createdAt: new Date().toISOString(),
    });
    const user = messages.value.at(-1)!;

    const assistantMessage: DisplayMessage = {
      id: `local-${Date.now()}-assistant`,
      chatId,
      role: "assistant",
      content: "",
      ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
      provider: null,
      model: null,
      createdAt: new Date().toISOString(),
      tools: [],
    };
    messages.value.push(assistantMessage);
    const assistant = messages.value.at(-1)!;
    isStreaming.value = true;
    controller = new AbortController();
    const startedAt = Date.now();

    try {
      for await (const event of client.sendMessage(chatId, content, options, controller.signal)) {
        if (event.type === "run.started") {
          assistant.provider = event.provider;
          assistant.model = event.model;
        } else if (event.type === "run.context") {
          user.context = event.context;
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
        } else if (event.type === "run.completed") {
          assistant.usage = event.usage;
        }
      }
    } catch (cause) {
      assistant.error = controller.signal.aborted ? "Генерация остановлена." : cause instanceof Error ? cause.message : String(cause);
      for (const tool of assistant.tools ?? []) {
        if (tool.status === "running") tool.status = "error";
      }
    } finally {
      assistant.durationMs = Date.now() - startedAt;
      isStreaming.value = false;
      controller = undefined;
    }
  }

  return { chats, activeChat, messages, isStreaming, isCompacting, contextRevision, compact, refreshChats, openChat, newChat, removeChat, sendMessage, stopGeneration };
}
