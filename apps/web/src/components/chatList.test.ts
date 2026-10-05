import { expect, it } from "vitest";
import { groupChats } from "./chatList.js";

const chats = [
  { id: "today", title: "  Ошибка   API ", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-02T09:00:00.000Z" },
  { id: "yesterday", title: "План релиза", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" },
  { id: "earlier", title: "Архитектура", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-30T09:00:00.000Z" },
];

it("filters chat titles without changing their incoming order", () => {
  const groups = groupChats(chats, "  api ", new Date("2026-10-02T12:00:00.000Z"));
  expect(groups).toEqual([{ label: "Сегодня", chats: [chats[0]] }]);
});

it("groups matching chats by local activity date and omits empty groups", () => {
  const groups = groupChats(chats, "", new Date("2026-10-02T12:00:00.000Z"));
  expect(groups.map(group => [group.label, group.chats.map(chat => chat.id)])).toEqual([
    ["Сегодня", ["today"]],
    ["Вчера", ["yesterday"]],
    ["Ранее", ["earlier"]],
  ]);
});

it("returns no groups when the query has no match", () => {
  expect(groupChats(chats, "не найдено", new Date("2026-10-02T12:00:00.000Z"))).toEqual([]);
});
