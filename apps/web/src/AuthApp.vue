<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import App from "./App.vue";
import { useAuth } from "./composables/useAuth.js";
import { SESSION_EXPIRED_EVENT } from "./api/client.js";

const { user, loading, busy, error, restore, submit, logout } = useAuth();
const mode = ref<"login" | "register">("login");
const login = ref("");
const password = ref("");
let channel: BroadcastChannel | undefined;
async function handleSubmit(): Promise<void> {
  if (await submit(mode.value, login.value, password.value)) {
    password.value = ""; channel?.postMessage("session-changed");
  }
}
async function handleLogout(): Promise<void> {
  if (await logout()) { mode.value = "login"; password.value = ""; channel?.postMessage("session-changed"); }
}
function refreshSession(): void { void restore(); }
onMounted(() => {
  refreshSession();
  window.addEventListener(SESSION_EXPIRED_EVENT, refreshSession);
  window.addEventListener("focus", refreshSession);
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("agenter-auth"); channel.onmessage = refreshSession;
  }
});
onUnmounted(() => {
  window.removeEventListener(SESSION_EXPIRED_EVENT, refreshSession);
  window.removeEventListener("focus", refreshSession);
  channel?.close();
});
</script>

<template>
  <template v-if="user">
    <App
      :key="user.id"
      :user-id="user.id"
      :login="user.login"
      :logging-out="busy"
      @logout="handleLogout"
    />
    <div
      v-if="error"
      class="app-error"
      role="alert"
    >
      {{ error }}
      <button
        type="button"
        @click="error = ''"
      >
        ×
      </button>
    </div>
  </template>
  <main
    v-else
    class="auth-screen"
  >
    <section
      class="auth-card"
      aria-labelledby="auth-title"
    >
      <div class="auth-brand">
        <span class="brand-mark">A</span> Agenter
      </div>
      <h1 id="auth-title">
        {{ loading ? 'Проверяем вход…' : mode === 'login' ? 'Вход в своё окружение' : 'Создать окружение' }}
      </h1>
      <p>У каждого пользователя своя история чатов. Модели, навыки и MCP общие.</p>
      <form
        v-if="!loading"
        @submit.prevent="handleSubmit"
      >
        <label for="auth-login">Логин</label>
        <input
          id="auth-login"
          v-model="login"
          name="username"
          autocomplete="username"
          autocapitalize="none"
          :spellcheck="false"
          minlength="3"
          maxlength="64"
          pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}"
          required
          :disabled="busy"
          aria-describedby="auth-login-hint"
        >
        <small id="auth-login-hint">3–64 символа: латинские буквы, цифры, дефис или подчёркивание</small>
        <label for="auth-password">Пароль</label>
        <input
          id="auth-password"
          v-model="password"
          name="password"
          type="password"
          :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
          minlength="8"
          maxlength="256"
          required
          :disabled="busy"
          aria-describedby="auth-password-hint"
        >
        <small id="auth-password-hint">От 8 до 256 символов</small>
        <p
          v-if="error"
          class="auth-error"
          role="alert"
        >
          {{ error }}
        </p>
        <button
          type="submit"
          class="primary-button"
          :disabled="busy"
        >
          {{ busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться' }}
        </button>
        <button
          type="button"
          class="auth-switch"
          :disabled="busy"
          @click="mode = mode === 'login' ? 'register' : 'login'; password = ''; error = ''"
        >
          {{ mode === 'login' ? 'Создать новое окружение' : 'Уже есть аккаунт — войти' }}
        </button>
      </form>
    </section>
  </main>
</template>
