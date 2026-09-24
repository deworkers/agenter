<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Chat, DisplayMessage, McpServerSummary, McpToolSummary, ProviderSummary, SkillSummary } from "../api/types.js";
import { providerPickerOptions } from "../composables/pickerOptions.js";
import MessageInput from "./MessageInput.vue";
import McpPanel from "./McpPanel.vue";
import OptionPicker from "./OptionPicker.vue";

const props = defineProps<{
  messages: DisplayMessage[];
  isStreaming: boolean;
  activeChat: Chat | null;
  providers: ProviderSummary[];
  defaultProviderId: string;
  providersLoading: boolean;
  providersError: string | null;
  skills: SkillSummary[];
  selectedSkillId: string;
  skillsLoading: boolean;
  skillsError: string | null;
  mcpServers: McpServerSummary[];
  mcpTools: McpToolSummary[];
  activeMcpServerIds: string[];
  mcpLoading: boolean;
  mcpError: string | null;
}>();

const providerId = defineModel<string>("providerId", { required: true });
const toolsOpen = ref(false);
const messageList = ref<HTMLElement | null>(null);
const providerOptions = computed(() => providerPickerOptions(props.providers, props.defaultProviderId));
const activeCapabilityCount = computed(() => props.activeMcpServerIds.length + (props.selectedSkillId ? 1 : 0));

const emit = defineEmits<{
  send: [content: string];
  newChat: [];
  retryProviders: [];
  retrySkills: [];
  retryMcp: [];
  toggleMcp: [id: string];
  toggleSkill: [id: string];
  addSkill: [];
}>();

watch(() => props.messages, async () => {
  await nextTick();
  messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: "smooth" });
}, { deep: true });

function renderMarkdown(content: string): string {
  const html = marked.parse(content, { async: false, breaks: true });
  return DOMPurify.sanitize(html);
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
      <div class="chat-heading">
        <span class="chat-heading-name">{{ activeChat?.title || 'Agenter' }}</span>
        <span class="chat-heading-subtitle">Локальный AI-чат</span>
      </div>
      <button
        class="header-action"
        type="button"
        :aria-expanded="toolsOpen"
        aria-controls="mcp-panel"
        @click="toolsOpen = !toolsOpen"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect
            x="3"
            y="3"
            width="7"
            height="7"
            rx="1.5"
          />
          <rect
            x="14"
            y="3"
            width="7"
            height="7"
            rx="1.5"
          />
          <rect
            x="3"
            y="14"
            width="7"
            height="7"
            rx="1.5"
          />
          <rect
            x="14"
            y="14"
            width="7"
            height="7"
            rx="1.5"
          />
        </svg>
        Инструменты
        <span
          class="tool-count"
        >{{ activeCapabilityCount ? `${activeCapabilityCount} активн.` : 'Выкл.' }}</span>
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
                <div
                  v-if="message.content"
                  class="message-content markdown-body"
                  v-html="renderMarkdown(message.content)"
                />
                <div
                  v-if="isStreaming && message === messages.at(-1) && !message.content && !message.tools?.length"
                  class="thinking"
                >
                  <span class="thinking-dot" /> Думаю…
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
                </div>
              </template>
            </div>
          </article>
        </div>
      </div>

      <div class="composer-wrap">
        <div class="composer">
          <MessageInput
            :disabled="isStreaming || providersLoading || !!providersError || !providerId"
            @send="(content) => emit('send', content)"
          />
          <div class="composer-controls">
            <div class="selector-group">
              <OptionPicker
                v-model="providerId"
                label="Модель"
                :options="providerOptions"
                :disabled="isStreaming || providersLoading || !!providersError || !providers.length"
                search-placeholder="Найти модель"
                empty-text="Модель не найдена"
              />
            </div>
            <span class="composer-hint">Enter — отправить · Shift+Enter — новая строка</span>
          </div>
        </div>
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

    <McpPanel
      v-if="toolsOpen"
      id="mcp-panel"
      :servers="mcpServers"
      :tools="mcpTools"
      :active-server-ids="activeMcpServerIds"
      :skills="skills"
      :selected-skill-id="selectedSkillId"
      :skills-loading="skillsLoading"
      :skills-error="skillsError"
      :is-streaming="isStreaming"
      :loading="mcpLoading"
      :error="mcpError"
      @close="toolsOpen = false"
      @refresh="emit('retryMcp')"
      @toggle="(id) => emit('toggleMcp', id)"
      @toggle-skill="(id) => emit('toggleSkill', id)"
      @retry-skills="emit('retrySkills')"
      @add-skill="emit('addSkill')"
    />
  </section>
</template>
