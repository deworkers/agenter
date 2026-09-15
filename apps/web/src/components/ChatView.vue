<script setup lang="ts">
import type { StoredMessage } from "../api/types.js";
import MessageInput from "./MessageInput.vue";

defineProps<{
  messages: StoredMessage[];
  isStreaming: boolean;
  hasActiveChat: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
}>();
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
          class="message"
          :class="message.role"
        >
          <div class="message-role">
            {{ message.role }}
          </div>
          <div class="message-content">
            {{ message.content }}
          </div>
          <div
            v-if="message.role === 'assistant' && message.model"
            class="message-meta"
          >
            {{ message.model }}
          </div>
        </div>
        <div
          v-if="isStreaming"
          class="message assistant streaming"
        >
          <div class="message-role">
            assistant
          </div>
          <div class="message-content">
            …
          </div>
        </div>
      </div>

      <MessageInput
        :disabled="isStreaming"
        @send="(content) => emit('send', content)"
      />
    </template>
  </section>
</template>
