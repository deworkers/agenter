import { computed, ref, type Ref } from "vue";
import type { Chat } from "../api/types.js";

export const chatStarters = [
  { title: "Найти и сравнить", description: "Собрать информацию и сопоставить выводы источников", prompt: "Помоги найти и сравнить информацию по теме: " },
  { title: "Отредактировать текст", description: "Сделать черновик яснее, короче или убедительнее", prompt: "Помоги отредактировать текст: сделай его яснее и сохрани основной смысл.\n\n" },
  { title: "Разобраться в документации", description: "Найти ответ в документации и объяснить по шагам", prompt: "Помоги разобраться в документации и объясни решение по шагам. Мой вопрос: " },
];

export function useChatHome(draft: Ref<string>, getChats: () => Chat[]) {
  const showAll = ref(false);
  const recentChats = computed(() => {
    const chats = [...getChats()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return showAll.value ? chats : chats.slice(0, 3);
  });
  function chooseStarter(prompt: string): void {
    draft.value = draft.value.trim() ? `${draft.value}\n\n${prompt}` : prompt;
  }
  return { showAll, recentChats, chooseStarter };
}
