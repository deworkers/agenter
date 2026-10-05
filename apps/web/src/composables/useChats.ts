import { ref } from "vue";
import * as client from "../api/client.js";
import type { Chat, DisplayMessage, SendMessageOptions } from "../api/types.js";
import { applyRunProgress } from "./runProgress.js";

export function useChats() {
  const chats = ref<Chat[]>([]);
  const activeChat = ref<Chat | null>(null);
  const messages = ref<DisplayMessage[]>([]);
  const isStreaming = ref(false);
  const isCompacting = ref(false);
  const activeRunChatId = ref<string | null>(null);
  const contextRevision = ref(0);
  let controller: AbortController | undefined;
  let openSequence = 0;
  let activeRun: { chatId: string; messages: DisplayMessage[] } | undefined;
  function stopGeneration(): void { controller?.abort(); }

  async function renameChat(chatId: string, title: string): Promise<void> {
    const chat = chats.value.find((item) => item.id === chatId);
    const active = activeChat.value?.id === chatId ? activeChat.value : null;
    if (!chat) return;
    const previousTitle = chat.title;
    const previousUpdatedAt = chat.updatedAt;
    const normalizedTitle = title.trim();
    const updatedAt = new Date().toISOString();
    chat.title = normalizedTitle;
    chat.updatedAt = updatedAt;
    if (active) { active.title = normalizedTitle; active.updatedAt = updatedAt; }
    chats.value = [...chats.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    try {
      const saved = await client.renameChat(chatId, normalizedTitle);
      Object.assign(chat, saved);
      if (active) Object.assign(active, saved);
      chats.value = [...chats.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch (error) {
      chat.title = previousTitle;
      chat.updatedAt = previousUpdatedAt;
      if (active) { active.title = previousTitle; active.updatedAt = previousUpdatedAt; }
      chats.value = [...chats.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      throw error;
    }
  }

  function showHome(): void {
    if (isCompacting.value) return;
    openSequence++;
    activeChat.value = null;
    messages.value = [];
  }

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
    if (isStreaming.value && activeRun?.chatId === chatId) {
      activeChat.value = chats.value.find((item) => item.id === chatId) ?? activeChat.value;
      messages.value = activeRun.messages;
      return;
    }
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
    if (activeRun?.chatId === chatId) return;
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
    const firstUserMessage = !messages.value.some((message) => message.role === "user");
    const defaultTitle = activeChat.value.title === "New chat" || activeChat.value.title === "Новый чат";
    if (firstUserMessage && defaultTitle) {
      const prompt = content.trim().replace(/\s+/g, " ");
      const attachmentName = options.attachments?.find((attachment) => attachment.name.trim() && !(attachment.source === "clipboard" && attachment.name === "Из буфера.txt"))?.name;
      const candidate = prompt || attachmentName || (options.attachments?.length ? "Вложения" : "Новый чат");
      const characters = Array.from(candidate);
      const title = characters.length > 60 ? `${characters.slice(0, 59).join("").trimEnd()}…` : candidate;
      activeChat.value.title = title;
      const listed = chats.value.find((chat) => chat.id === chatId);
      if (listed) listed.title = title;
    }
    activeChat.value.updatedAt = new Date().toISOString();
    const listed = chats.value.find((chat) => chat.id === chatId);
    if (listed) {
      listed.updatedAt = activeChat.value.updatedAt;
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
      runPhase: "waiting",
      provisional: false,
      runStartedAt: Date.now(),
    };
    messages.value.push(assistantMessage);
    const assistant = messages.value.at(-1)!;
    isStreaming.value = true;
    activeRunChatId.value = chatId;
    activeRun = { chatId, messages: messages.value };
    controller = new AbortController();
    const startedAt = Date.now();

    try {
      for await (const event of client.sendMessage(chatId, content, options, controller.signal)) {
        if (event.type === "run.started") {
          assistant.provider = event.provider;
          assistant.model = event.model;
        } else if (event.type === "run.phase") {
          applyRunProgress(assistant, event);
        } else if (event.type === "run.context") {
          user.context = event.context;
        } else if (event.type === "text.delta") {
          assistant.content += event.text;
          applyRunProgress(assistant, event);
        } else if (event.type === "text.reset") {
          assistant.content = "";
          applyRunProgress(assistant, event);
        } else if (event.type === "tool.started") {
          assistant.tools?.push({ name: event.tool, arguments: event.arguments, status: "running" });
          applyRunProgress(assistant, event);
        } else if (event.type === "tool.completed") {
          const tool = assistant.tools?.findLast((item) => item.name === event.tool && item.status === "running");
          if (tool) {
            tool.result = event.result;
            tool.status = "completed";
          }
          applyRunProgress(assistant, event);
        } else if (event.type === "tool.failed") {
          const tool = assistant.tools?.findLast((item) => item.name === event.tool && item.status === "running");
          if (tool) {
            tool.status = "error";
            tool.result = { error: { code: event.code, message: "Источник инструмента временно недоступен." } };
          }
        } else if (event.type === "run.error") {
          assistant.error = event.message;
          assistant.errorCode = event.code;
          applyRunProgress(assistant, event);
          for (const tool of assistant.tools ?? []) {
            if (tool.status === "running") tool.status = "error";
          }
        } else if (event.type === "run.completed") {
          assistant.usage = event.usage;
          applyRunProgress(assistant, event);
        }
      }
    } catch (cause) {
      assistant.error = controller.signal.aborted ? "Генерация остановлена." : cause instanceof Error ? cause.message : String(cause);
      applyRunProgress(assistant, { type: "run.error", message: assistant.error });
      for (const tool of assistant.tools ?? []) {
        if (tool.status === "running") tool.status = "error";
      }
    } finally {
      assistant.durationMs = Date.now() - startedAt;
      isStreaming.value = false;
      activeRunChatId.value = null;
      activeRun = undefined;
      controller = undefined;
    }
  }

  return { chats, activeChat, messages, isStreaming, activeRunChatId, isCompacting, contextRevision, compact, refreshChats, openChat, newChat, showHome, removeChat, renameChat, sendMessage, stopGeneration };
}
