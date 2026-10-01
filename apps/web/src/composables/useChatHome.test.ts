import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useChatHome } from "./useChatHome.js";

describe("chat home", () => {
  it("shows the three most recently updated chats without reordering the catalog", () => {
    const chats = ref([1, 4, 2, 3].map(day => ({ id: `${day}`, title: `Chat ${day}`, createdAt: "2026-09-01", updatedAt: `2026-09-0${day}` })));
    const home = useChatHome(ref(""), () => chats.value);
    expect(home.recentChats.value.map(chat => chat.id)).toEqual(["4", "3", "2"]);
    expect(chats.value.map(chat => chat.id)).toEqual(["1", "4", "2", "3"]);
    home.showAll.value = true;
    expect(home.recentChats.value).toHaveLength(4);
    chats.value = [];
    expect(home.recentChats.value).toEqual([]);
  });

  it("fills an empty draft and preserves existing writing when choosing another starter", () => {
    const draft = ref("");
    const home = useChatHome(draft, () => []);
    home.chooseStarter("Помоги улучшить текст:");
    expect(draft.value).toBe("Помоги улучшить текст:");
    draft.value = "Мой незаконченный вопрос";
    home.chooseStarter("Найди и сравни:");
    expect(draft.value).toBe("Мой незаконченный вопрос\n\nНайди и сравни:");
  });
});
