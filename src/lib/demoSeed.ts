import type { Chat } from "../types";

/**
 * Deterministic chats for the Playwright smoke suite.
 *
 * The real app starts empty on purpose: demo chats used to leak into the
 * production path, so `useChatCollection` clears them on first launch. Tests
 * still need a known starting state, so this seed is only used when
 * `VITE_DEMO_SEED=true` is part of the build (the `demo` mode does that).
 */
export function createDemoSeedChats(now: number = Date.now()): Chat[] {
  return [
    {
      id: 1,
      name: "Максим",
      avatar: "М",
      color: "blue",
      preview: "Смотри, что нашёл",
      time: "12:41",
      unread: 2,
      messages: [
        { id: 1, author: "Максим", text: "Привет! Как дела?", time: "12:30", createdAt: now - 660_000 },
        {
          id: 2,
          author: "Максим",
          text: "Смотри, что нашёл",
          time: "12:41",
          createdAt: now - 60_000,
          // A one-pixel PNG as a data URL: the seed exists so browser tests can check
          // that pictures load, or wait for a tap, without needing a network.
          attachment: {
            name: "находка.png",
            type: "image/png",
            size: 4096,
            data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          },
        },
      ],
      lastReadAt: now - 600_000,
    },
    {
      id: 2,
      name: "Игорь",
      avatar: "И",
      color: "olive",
      preview: "Созвонимся вечером",
      time: "11:02",
      messages: [
        { id: 3, author: "Игорь", text: "Созвонимся вечером", time: "11:02", createdAt: now - 3_600_000 },
      ],
    },
    {
      id: 3,
      name: "Аня",
      avatar: "А",
      color: "pink",
      preview: "Спасибо!",
      time: "10:15",
      pinned: true,
      messages: [
        { id: 4, author: "Аня", text: "Спасибо!", time: "10:15", createdAt: now - 7_200_000 },
        { id: 6, author: "Я", text: "Приятно!", time: "10:16", createdAt: now - 7_140_000, mine: true },
      ],
    },
    {
      id: 5,
      name: "Длинный чат",
      avatar: "Д",
      color: "violet",
      preview: "Сообщение 60 из 60",
      time: "08:00",
      // Sixty messages guarantee the conversation is taller than any viewport the suite
      // uses, so "opens at the bottom" is a claim a test can actually measure.
      messages: Array.from({ length: 60 }, (_, index) => ({
        id: 1000 + index,
        author: index % 3 === 0 ? "Я" : "Максим",
        mine: index % 3 === 0,
        text: `Длинный чат, сообщение ${index + 1}`,
        time: "08:00",
        createdAt: now - (60 - index) * 60_000,
      })),
    },
    {
      id: 4,
      name: "Команда",
      avatar: "К",
      color: "orange",
      preview: "План на неделю",
      time: "09:30",
      group: true,
      members: ["Максим", "Аня"],
      inviteCode: "demo-team",
      messages: [
        { id: 5, author: "Аня", text: "План на неделю", time: "09:30", createdAt: now - 10_800_000 },
      ],
    },
  ];
}
