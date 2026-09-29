<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Chat, ContextBudget, DisplayMessage, ProviderSummary, TextAttachment, ResponseFormat } from "../api/types.js";
import { providerPickerOptions } from "../composables/pickerOptions.js";
import MessageInput from "./MessageInput.vue";
import OptionPicker from "./OptionPicker.vue";
import { parseChatCommand } from "../composables/chatCommands.js";
import { contextProgress } from "../composables/contextMeter.js";
import TextAttachments from "./TextAttachments.vue";
import AnswerFiles from "./AnswerFiles.vue";
import { saveTextFile } from "../composables/answerFiles.js";

const props = defineProps<{
  messages: DisplayMessage[];
  isStreaming: boolean;
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
const messageList = ref<HTMLElement | null>(null);
const providerOptions = computed(() => providerPickerOptions(props.providers, props.defaultProviderId));
const occupancy = computed(() => props.budget ? contextProgress(props.budget) : { value: 0, max: 1 });
const isCommand = computed(() => parseChatCommand(draft.value) !== null);
defineExpose({ openModelPicker: () => modelPicker.value?.open() });

const emit = defineEmits<{
  send: [content: string, attachments: TextAttachment[]];
  newChat: [];
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
        <span class="chat-heading-name">{{ activeChat?.title || 'Agenter' }}</span>
        <span class="chat-heading-subtitle">Локальный AI-чат</span>
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
        <div class="welcome-mark">
          ✳
        </div>
        <h1>С чего начнём?</h1>
        <p>Задайте вопрос, выберите модель или подключите навык для задачи.</p>
        <button
          v-if="!activeChat"
          class="welcome-action"
          type="button"
          @click="emit('newChat')"
        >
          Создать чат
        </button>
      </div>

      <div
        v-else
        ref="messageList"
        class="message-list"
        aria-live="polite"
      >
        <div class="conversation">
          <article
            v-for="message in messages"
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
                  v-if="isStreaming && message === messages.at(-1) && !message.content && !message.tools?.length"
                  class="thinking"
                >
                  <span class="thinking-dot" /> Думаю…
                </div>
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
                      <template v-if="tool.status === 'completed'">
                        <div class="tool-data-label">
                          Результат
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
                  {{ message.error }}
                </div>
                <div
                  v-if="message.provider || message.model || message.durationMs !== undefined"
                  class="message-meta"
                >
                  <span v-if="message.model">{{ message.model }}</span>
                  <span v-if="message.provider && message.provider !== message.model">{{ message.provider }}</span>
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
            v-model:draft="draft"
            v-model:attachments="attachments"
            :draft-key="activeChat?.id ?? 'new'"
            :streaming="isStreaming"
            :disabled="isStreaming || (!isCommand && (providersLoading || !!providersError || !providerId || !!budget?.overLimit))"
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
            <span class="composer-hint">Ctrl+V — вложение · Enter — отправить</span>
          </div>
        </div>
        <details
          v-if="budget"
          class="context-meter"
          :class="{over:budget.overLimit}"
        >
          <summary :aria-busy="contextUpdating">
            Контекст ≈{{ tokens(budget.usedTokens) }} / {{ tokens(budget.contextWindow) }} · свободно ≈{{ tokens(budget.availableTokens) }}<span
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
          Ответы модели могут содержать ошибки. Проверяйте важные сведения.
        </p>
      </div>
    </div>
  </section>
</template>
