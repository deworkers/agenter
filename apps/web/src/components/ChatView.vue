<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { StoredMessage, ProviderSummary } from "../api/types.js";
import MessageInput from "./MessageInput.vue";

defineProps<{
  messages: StoredMessage[];
  isStreaming: boolean;
  hasActiveChat: boolean;
  providers: ProviderSummary[];
  defaultProviderId: string;
  providersLoading: boolean;
  providersError: string | null;
}>();

const providerId = defineModel<string>("providerId", { required: true });

const emit = defineEmits<{
  send: [content: string];
  retryProviders: [];
}>();

function renderMarkdown(content: string): string {
  const html = marked.parse(content, { async: false, breaks: true });
  return DOMPurify.sanitize(html);
}
</script>

<template>
  <section class="chat-view">
    <div
      v-if="!hasActiveChat"
      class="empty-state"
    >
      Select or create a chat to get started.
    </div>

    <template v-else>
      <div class="message-list">
        <div
          v-for="message in messages"
          :key="message.id"
          class="message-row"
          :class="message.role"
        >
          <div class="message-avatar">
            {{ message.role === 'user' ? 'U' : 'AI' }}
          </div>
          <div
            class="message"
            :class="message.role"
          >
            <div class="message-role">
              {{ message.role }}
            </div>
            <div
              class="message-content markdown-body"
              v-html="renderMarkdown(message.content)"
            />
            <div
              v-if="message.role === 'assistant' && message.model"
              class="message-meta"
            >
              {{ message.provider ? `${message.provider} · ` : '' }}{{ message.model }}
            </div>
          </div>
        </div>
        <div
          v-if="isStreaming"
          class="message-row assistant"
        >
          <div class="message-avatar">
            AI
          </div>
          <div class="message assistant streaming">
            <div class="message-role">
              assistant
            </div>
            <div class="message-content">
              …
            </div>
          </div>
        </div>
      </div>

      <div class="provider-picker">
        <label for="provider-select">Provider</label>
        <select
          id="provider-select"
          v-model="providerId"
          :disabled="isStreaming || providersLoading || !!providersError || !providers.length"
        >
          <option
            v-if="!providers.length"
            value=""
          >
            {{ providersLoading ? 'Loading providers…' : 'Providers unavailable' }}
          </option>
          <option
            v-for="provider in providers"
            :key="provider.id"
            :value="provider.id"
          >
            {{ provider.id }} — {{ provider.model }}{{ provider.id === defaultProviderId ? ' (default)' : '' }}
          </option>
        </select>
        <div
          v-if="providersError"
          class="provider-error"
          role="alert"
        >
          <span>Could not load providers: {{ providersError }}</span>
          <button
            type="button"
            :disabled="providersLoading || isStreaming"
            @click="emit('retryProviders')"
          >
            Retry
          </button>
        </div>
      </div>
      <MessageInput
        :disabled="isStreaming || providersLoading || !!providersError || !providerId"
        @send="(content) => emit('send', content)"
      />
    </template>
  </section>
</template>
