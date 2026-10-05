<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Chat, ContextBudget, DisplayMessage, ProviderSummary, TextAttachment, ResponseFormat } from "../api/types.js";
import { providerPickerOptions } from "../composables/pickerOptions.js";
import MessageInput from "./MessageInput.vue";
import OptionPicker from "./OptionPicker.vue";
import { parseChatCommand } from "../composables/chatCommands.js";
import { contextProgress, contextSummary } from "../composables/contextMeter.js";
import TextAttachments from "./TextAttachments.vue";
import AnswerFiles from "./AnswerFiles.vue";
import { saveTextFile } from "../composables/answerFiles.js";
import { chatStarters, useChatHome } from "../composables/useChatHome.js";
import { runErrorPresentation } from "../composables/runErrorPresentation.js";

const props = defineProps<{
  messages: DisplayMessage[];
  chats: Chat[];
  isStreaming: boolean;
  generationActive: boolean;
  activeGenerationChatTitle: string;
  activeChat: Chat | null;
  providers: ProviderSummary[];
  defaultProviderId: string;
  providersLoading: boolean;
  providersError: string | null;
  budget: ContextBudget | null;
  contextError: string;
  contextUpdating: boolean;
  commandNotice: string;
}>();

const providerId = defineModel<string>("providerId", { required: true });
const draft = defineModel<string>("draft", { required: true });
const attachments = defineModel<TextAttachment[]>("attachments", { required: true });
const responseFormat = defineModel<ResponseFormat>("responseFormat", { required: true });
const historyLimit = defineModel<number | undefined>("historyLimit", { default: undefined });
const modelPicker = ref<InstanceType<typeof OptionPicker> | null>(null);
const clock = ref(Date.now());
const clockTimer = window.setInterval(() => { clock.value = Date.now(); }, 250);
onUnmounted(() => window.clearInterval(clockTimer));
const messageList = ref<HTMLElement | null>(null);
const messageInput = ref<InstanceType<typeof MessageInput> | null>(null);
const { recentChats, showAll, chooseStarter } = useChatHome(draft, () => props.chats);
async function startPrompt(prompt: string): Promise<void> {
  chooseStarter(prompt);
  await nextTick();
  messageInput.value?.focus();
}
function chatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ru", { day: "numeric", month: "short" });
}
const providerOptions = computed(() => providerPickerOptions(props.providers, props.defaultProviderId));
const occupancy = computed(() => props.budget ? contextProgress(props.budget) : { value: 0, max: 1 });
const isCommand = computed(() => parseChatCommand(draft.value) !== null);
const currentAssistant = computed(() => {
  const latest = props.messages.at(-1);
  return latest?.role === "assistant" ? latest : undefined;
});
const routeNotice = computed(() => {
  if (!props.isStreaming || providerId.value !== "auto") return "";
  const message = currentAssistant.value;
  if (!message?.provider) return "Модель выберется автоматически по задаче";
  const provider = props.providers.find((item) => item.id === message.provider);
  return `Автоматически выбрана: ${provider?.label || message.provider} · ${message.model || "модель"}`;
});
function providerLabel(id: string): string {
  const provider = props.providers.find((item) => item.id === id);
  return provider?.label || id;
}
function progressLabel(message: DisplayMessage): string {
  if (message.runPhase === "checking") return "Проверяю ответ…";
  if (message.runPhase === "receiving") return "Получаю ответ…";
  if (message.runPhase === "tool") return `Выполняю инструмент ${message.currentTool || "…"}`;
  if (message.runPhase === "error") return message.error?.includes("остановлена") ? "Генерация остановлена" : "Ошибка генерации";
  return "Ожидаю ответ модели…";
}
function terminalStatus(message: DisplayMessage): string {
  if (message.runPhase === "completed") return "Завершено";
  if (message.runPhase === "error") return message.error?.includes("остановлена") ? "Остановлено" : "Ошибка";
  return "";
}
defineExpose({ openModelPicker: () => modelPicker.value?.open() });

const emit = defineEmits<{
  send: [content: string, attachments: TextAttachment[]];
  retry: [content: string, attachments: TextAttachment[]];
  returnToGeneration: [];
  selectChat: [id: string];
  retryProviders: [];
  stop: [];
  menu: [];
  settings: [];
}>();

watch(() => props.messages, async () => {
  const list = messageList.value;
  const nearBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  await nextTick();
  if (nearBottom) messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: "instant" });
}, { deep: true });
watch(() => props.activeChat?.id, async () => { await nextTick(); messageList.value?.scrollTo({ top: messageList.value.scrollHeight }); });
const copied = ref("");
async function copy(text: string, id: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); copied.value = id; } catch { copied.value = ""; }
}
function copyCode(event: MouseEvent, messageId: string): void {
  const target = event.target as HTMLElement;
  const button = target.closest(".copy-code");
  const code = button?.closest("pre")?.querySelector("code");
  if (code) void copy(code.textContent ?? "", `${messageId}:code`);
}
function tokens(value: number): string { return new Intl.NumberFormat("ru").format(value); }

function renderMarkdown(content: string): string {
  const html = marked.parse(content, { async: false, breaks: true });
  return DOMPurify.sanitize(html).replace(/<pre>/g, '<pre><button type="button" class="copy-code">Копировать код</button>');
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "Данные недоступны";
  }
}

function duration(ms: number): string {
  return `${(ms / 1000).toFixed(1)} с`;
}
</script>

<template>
  <section class="chat-view">
    <div
      v-if="generationActive && !isStreaming"
      class="generation-elsewhere"
      role="status"
    >
      <span>Генерация продолжается в «{{ activeGenerationChatTitle }}».</span>
      <button
        type="button"
        @click="emit('returnToGeneration')"
      >
        Вернуться
      </button>
      <button
        type="button"
        @click="emit('stop')"
      >
        Остановить
      </button>
    </div>
    <header class="chat-header">
      <button
        class="icon-button mobile-only"
        type="button"
        aria-label="Открыть историю чатов"
        @click="emit('menu')"
      >
        ☰
      </button>
      <div class="chat-heading">
        <span class="chat-heading-workspace">Личное пространство</span>
        <span
          class="breadcrumb-separator"
          aria-hidden="true"
        >/</span>
        <span class="chat-heading-name">{{ activeChat?.title || 'Новый диалог' }}</span>
      </div>
      <button
        class="icon-button mobile-only"
        type="button"
        aria-label="Открыть настройки"
        @click="emit('settings')"
      >
        ⚙
      </button>
    </header>

    <div
      class="chat-body"
      :class="{ 'chat-body-empty': messages.length === 0 }"
    >
      <div
        v-if="messages.length === 0"
        class="welcome"
      >
        <div class="welcome-eyebrow">
          Ваш ИИ-помощник
        </div>
        <h1>С чего начнём?</h1>
        <p>Ищите информацию, улучшайте тексты или разбирайтесь в документации.</p>
      </div>

      <div
        v-else
        ref="messageList"
        class="message-list"
        aria-live="polite"
      >
        <div class="conversation">
          <article
            v-for="(message, messageIndex) in messages"
            :key="message.id"
            class="message-row"
            :class="message.role"
          >
            <div
              v-if="message.role === 'assistant'"
              class="assistant-mark"
              aria-label="Agenter"
            >
              ✳
            </div>
            <div
              class="message"
              :class="message.role"
            >
              <template v-if="message.role === 'user'">
                <div class="user-content">
                  {{ message.content }}
                </div>
                <TextAttachments :items="message.attachments ?? []" />
                <details
                  v-if="message.context"
                  class="request-context"
                >
                  <summary>
                    <span>Контекст запроса</span>
                    <span
                      v-if="message.context.skill"
                      class="context-chip"
                    >Навык: {{ message.context.skill.id }}</span>
                    <span
                      v-if="message.context.tools.length"
                      class="context-chip"
                    >Инструменты: {{ message.context.tools.length }}</span>
                  </summary>
                  <div class="request-context-body">
                    <div v-if="message.context.systemPrompt">
                      <div class="tool-data-label">
                        Системная инструкция
                      </div>
                      <pre>{{ message.context.systemPrompt }}</pre>
                    </div>
                    <div v-if="message.context.skill">
                      <div class="tool-data-label">
                        Навык · {{ message.context.skill.id }}
                      </div>
                      <pre>{{ message.context.skill.content }}</pre>
                    </div>
                    <div v-if="message.context.tools.length">
                      <div class="tool-data-label">
                        Доступные модели инструменты
                      </div>
                      <div
                        v-for="tool in message.context.tools"
                        :key="tool.name"
                        class="request-tool"
                      >
                        <strong>{{ tool.name }}</strong><span>{{ tool.description }}</span>
                        <pre>{{ jsonText(tool.inputSchema) }}</pre>
                      </div>
                    </div>
                  </div>
                </details>
              </template>
              <template v-else>
                <AnswerFiles
                  v-if="message.content && !message.error && !(isStreaming && message === messages.at(-1))"
                  :content="message.content"
                  :response-format="message.responseFormat"
                />
                <!-- eslint-disable vue/no-v-html -- Markdown is sanitized by DOMPurify. -->
                <div
                  v-if="message.content"
                  class="message-content markdown-body"
                  @click="copyCode($event, message.id)"
                  v-html="renderMarkdown(message.content)"
                />
                <!-- eslint-enable vue/no-v-html -->
                <div
                  v-if="isStreaming && message === messages.at(-1) && message.runPhase"
                  class="run-progress"
                  role="status"
                  aria-live="polite"
                >
                  <span class="thinking-dot" />
                  <span>{{ progressLabel(message) }}</span>
                  <time v-if="message.runStartedAt">{{ duration(clock - message.runStartedAt) }}</time>
                </div>
                <p
                  v-if="isStreaming && message === messages.at(-1) && message.provisional"
                  class="answer-provisional"
                  role="status"
                >
                  Ответ предварительный · продолжаю проверку
                </p>
                <div
                  v-if="message.content"
                  class="message-actions"
                >
                  <button
                    type="button"
                    @click="copy(message.content,message.id)"
                  >
                    {{ copied===message.id ? 'Скопировано' : 'Копировать ответ' }}
                  </button>
                  <button
                    v-if="!message.error && !(isStreaming && message === messages.at(-1))"
                    type="button"
                    @click="saveTextFile('answer.md', message.content, 'text/markdown;charset=utf-8')"
                  >
                    Скачать ответ .md
                  </button>
                  <small v-if="copied===`${message.id}:code`">Код скопирован</small>
                </div>
                <div
                  v-if="message.tools?.length"
                  class="tool-activity"
                >
                  <details
                    v-for="(tool, index) in message.tools"
                    :key="`${message.id}-${index}`"
                    class="tool-call"
                  >
                    <summary>
                      <span class="tool-call-icon">⌘</span>
                      <span class="tool-call-name">{{ tool.name }}</span>
                      <span
                        class="tool-status"
                        :class="tool.status"
                      >{{ tool.status === 'running' ? 'Выполняется' : tool.status === 'error' ? 'Ошибка' : 'Готово' }}</span>
                    </summary>
                    <div class="tool-call-details">
                      <div class="tool-data-label">
                        Аргументы
                      </div>
                      <pre>{{ jsonText(tool.arguments) }}</pre>
                      <template v-if="tool.result !== undefined">
                        <div class="tool-data-label">
                          {{ tool.status === 'completed' ? 'Результат' : 'Безопасная причина ошибки' }}
                        </div>
                        <pre>{{ jsonText(tool.result) }}</pre>
                      </template>
                    </div>
                  </details>
                </div>
                <div
                  v-if="message.error"
                  class="message-error"
                  role="alert"
                >
                  <strong>{{ runErrorPresentation(message).reason }}</strong>
                  <p v-if="runErrorPresentation(message).nextStep">
                    {{ runErrorPresentation(message).nextStep }}
                  </p>
                  <button
                    v-if="message.role === 'assistant' && messages[messageIndex - 1]?.role === 'user'"
                    type="button"
                    :disabled="isStreaming"
                    @click="emit('retry', messages[messageIndex - 1]!.content, messages[messageIndex - 1]!.attachments ?? [])"
                  >
                    Повторить запрос
                  </button>
                </div>
                <div
                  v-if="message.provider || message.model || message.durationMs !== undefined"
                  class="message-meta"
                >
                  <span v-if="message.provider">{{ providerLabel(message.provider) }}</span>
                  <span
                    v-if="terminalStatus(message)"
                    class="run-terminal-status"
                  >{{ terminalStatus(message) }}</span>
                  <details
                    v-if="message.model"
                    class="message-model-details"
                  >
                    <summary>Модель</summary>
                    <code>{{ message.model }}</code>
                  </details>
                  <span v-if="message.durationMs !== undefined">{{ duration(message.durationMs) }}</span>
                  <span v-if="message.usage">{{ tokens(message.usage.promptTokens + message.usage.completionTokens) }} токенов за запуск</span>
                </div>
              </template>
            </div>
          </article>
        </div>
      </div>

      <div class="composer-wrap">
        <div class="composer">
          <MessageInput
            ref="messageInput"
            v-model:draft="draft"
            v-model:attachments="attachments"
            :draft-key="activeChat?.id ?? 'new'"
            :streaming="isStreaming"
            :disabled="generationActive || isStreaming || (!isCommand && (providersLoading || !!providersError || !providerId || !!budget?.overLimit))"
            @send="(content, files) => emit('send', content, files)"
            @stop="emit('stop')"
          />
          <div class="composer-controls">
            <div class="selector-group">
              <OptionPicker
                ref="modelPicker"
                v-model="providerId"
                label="Модель"
                :options="providerOptions"
                :disabled="isStreaming || providersLoading || !!providersError || !providers.length"
                search-placeholder="Найти модель"
                empty-text="Модель не найдена"
              />
              <label class="response-format">Ответ
                <select
                  v-model="responseFormat"
                  :disabled="isStreaming"
                  aria-label="Формат ответа"
                >
                  <option value="text">Текст</option><option value="markdown">Файл .md</option><option value="html">Файл HTML</option>
                </select>
              </label>
            </div>
            <small
              v-if="routeNotice"
              class="run-route-status"
              role="status"
            >{{ routeNotice }}</small>
            <span class="composer-hint">/ — команды · Enter — отправить</span>
          </div>
        </div>
        <details
          v-if="budget"
          class="context-meter"
          :class="{over:budget.overLimit}"
        >
          <summary :aria-busy="contextUpdating">
            {{ contextSummary(budget) }}<span
              class="context-refresh-status"
              :title="contextUpdating ? 'Пересчёт…' : contextError ? 'Оценка устарела' : ''"
              :aria-label="contextUpdating ? 'Пересчёт…' : contextError ? 'Оценка устарела' : undefined"
            >{{ contextUpdating ? '⟳' : contextError ? '!' : '' }}</span>
          </summary>
          <progress
            :value="occupancy.value"
            :max="occupancy.max"
            aria-label="Заполнение окна контекста"
          />
          <div class="context-breakdown">
            <span
              v-for="(label,key) in {system:'Система',skill:'Навык',tools:'Инструменты',history:'История',message:'Сообщение',results:'Результаты'}"
              :key="key"
            >{{ label }}: ≈{{ tokens(budget.breakdown[key]) }}</span><span>Резерв ответа: {{ tokens(budget.outputReserve) }}</span>
          </div>
          <small>Оценка по размеру текста; точный расход зависит от токенизатора модели.</small>
          <label>История в запросе<select v-model="historyLimit"><option :value="undefined">Вся история</option><option :value="20">Последние 20 сообщений</option><option :value="0">Без прошлых сообщений</option></select></label>
          <p
            v-if="budget.overLimit"
            role="alert"
          >
            Контекст переполнен. Уменьшите текст/вложения, историю или число инструментов.
          </p>
        </details>
        <small
          v-else
          class="context-meter"
        >{{ contextError || 'Оценка контекста…' }}</small>
        <p
          v-if="commandNotice"
          class="command-notice"
          role="status"
        >
          {{ commandNotice }}
        </p>
        <div
          v-if="providersError"
          class="catalog-errors"
          role="alert"
        >
          Модели недоступны: {{ providersError }}
          <button
            type="button"
            @click="emit('retryProviders')"
          >
            Повторить
          </button>
        </div>
        <p class="composer-note">
          Проверяйте важные факты по источникам
        </p>
      </div>
      <div
        v-if="messages.length === 0"
        class="home-sections"
      >
        <section
          class="starter-section"
          aria-labelledby="starter-heading"
        >
          <h2 id="starter-heading">
            Попробуйте, например
          </h2>
          <div class="starter-grid">
            <button
              v-for="starter in chatStarters"
              :key="starter.title"
              type="button"
              class="starter-card"
              :disabled="isStreaming"
              @click="startPrompt(starter.prompt)"
            >
              <strong>{{ starter.title }}</strong>
              <span>{{ starter.description }}</span>
            </button>
          </div>
        </section>
        <section
          class="recent-section"
          aria-labelledby="recent-heading"
        >
          <div class="home-section-heading">
            <h2 id="recent-heading">
              Недавние диалоги
            </h2>
            <button
              v-if="chats.length > 3"
              type="button"
              :aria-expanded="showAll"
              @click="showAll = !showAll"
            >
              {{ showAll ? 'Свернуть ↑' : 'Все диалоги →' }}
            </button>
          </div>
          <ul
            v-if="recentChats.length"
            class="recent-chats"
          >
            <li
              v-for="chat in recentChats"
              :key="chat.id"
            >
              <button
                type="button"
                :disabled="isStreaming"
                @click="emit('selectChat', chat.id)"
              >
                <span
                  class="recent-chat-icon"
                  aria-hidden="true"
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                  ><path d="M4 4h16v12H8l-4 4V4Z" /><path d="M8 8h8M8 12h5" /></svg>
                </span>
                <span class="recent-chat-title">{{ chat.title }}</span>
                <time :datetime="chat.updatedAt">{{ chatDate(chat.updatedAt) }}</time>
              </button>
            </li>
          </ul>
          <p
            v-else
            class="recent-empty"
          >
            Здесь будут ваши диалоги. Начните с вопроса или выберите пример выше.
          </p>
        </section>
      </div>
    </div>
  </section>
</template>
