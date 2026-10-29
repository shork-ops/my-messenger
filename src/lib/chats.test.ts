import { describe, expect, it } from "vitest";
import type { Chat, Message } from "../types";
import {
  appendMessage,
  filterChats,
  getGalleryImages,
  getVisibleMessages,
  mapMessagesByRemoteId,
  markRead,
  matchesChatFilter,
  removeMessage,
  restoreMessage,
  sortChats,
  splitArchived,
  togglePinned,
  updateChat,
  upsertChat,
} from "./chats";

function message(overrides: Partial<Message> = {}): Message {
  return { id: 1, author: "Аня", text: "привет", time: "10:00", createdAt: 1, ...overrides };
}

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 1,
    name: "Аня",
    avatar: "А",
    color: "blue",
    preview: "привет",
    time: "10:00",
    messages: [message()],
    ...overrides,
  };
}

describe("sortChats", () => {
  it("puts pinned chats first and keeps the rest in order", () => {
    const chats = [chat({ id: 1 }), chat({ id: 2, pinned: true }), chat({ id: 3 })];
    expect(sortChats(chats).map((item) => item.id)).toEqual([2, 1, 3]);
  });

  it("does not mutate the source array", () => {
    const chats = [chat({ id: 1 }), chat({ id: 2, pinned: true })];
    sortChats(chats);
    expect(chats.map((item) => item.id)).toEqual([1, 2]);
  });
});

describe("filterChats", () => {
  it("matches by name, preview and message text", () => {
    const chats = [
      chat({ id: 1, name: "Аня" }),
      chat({ id: 2, name: "Команда", preview: "созвон" }),
      chat({ id: 3, name: "Игорь", messages: [message({ text: "уникальное слово" })] }),
    ];
    expect(filterChats(chats, "аня").map((item) => item.id)).toEqual([1]);
    expect(filterChats(chats, "созвон").map((item) => item.id)).toEqual([2]);
    expect(filterChats(chats, "уникальное").map((item) => item.id)).toEqual([3]);
  });

  it("returns everything for an empty query", () => {
    const chats = [chat({ id: 1 }), chat({ id: 2 })];
    expect(filterChats(chats, "   ")).toHaveLength(2);
  });
});

describe("getVisibleMessages", () => {
  it("filters by text or author ignoring case", () => {
    const messages = [message({ id: 1, text: "Привет" }), message({ id: 2, text: "пока", author: "Игорь" })];
    expect(getVisibleMessages(messages, "ПРИВ").map((item) => item.id)).toEqual([1]);
    expect(getVisibleMessages(messages, "игорь").map((item) => item.id)).toEqual([2]);
    expect(getVisibleMessages(messages, "")).toHaveLength(2);
  });
});

describe("appendMessage", () => {
  it("appends a message and updates preview and time", () => {
    const chats = [chat({ id: 1, preview: "старое", time: "09:00" })];
    const next = appendMessage(chats, 1, message({ id: 2, text: "новое", time: "11:11" }));
    expect(next[0].messages.map((item) => item.id)).toEqual([1, 2]);
    expect(next[0].preview).toBe("новое");
    expect(next[0].time).toBe("11:11");
  });

  it("accepts a custom preview", () => {
    const chats = [chat({ id: 1 })];
    const next = appendMessage(chats, 1, message({ id: 2 }), "📎 файл", "12:00");
    expect(next[0].preview).toBe("📎 файл");
    expect(next[0].time).toBe("12:00");
  });
});

describe("removeMessage", () => {
  it("keeps the preview when a middle message is removed", () => {
    const chats = [chat({ id: 1, preview: "третье", messages: [message({ id: 1 }), message({ id: 2 }), message({ id: 3, text: "третье" })] })];
    const { chats: next, removed } = removeMessage(chats, 1, 2);
    expect(removed?.index).toBe(1);
    expect(next[0].messages.map((item) => item.id)).toEqual([1, 3]);
    expect(next[0].preview).toBe("третье");
  });

  it("recomputes the preview when the last message is removed", () => {
    const chats = [chat({ id: 1, preview: "второе", messages: [message({ id: 1, text: "первое" }), message({ id: 2, text: "второе" })] })];
    const { chats: next } = removeMessage(chats, 1, 2);
    expect(next[0].preview).toBe("первое");
  });

  it("falls back to an empty-state preview when everything is deleted", () => {
    const chats = [chat({ id: 1 })];
    const { chats: next } = removeMessage(chats, 1, 1);
    expect(next[0].preview).toBe("Нет сообщений");
    expect(next[0].time).toBe("");
  });

  it("reports nothing removed for an unknown message", () => {
    const chats = [chat({ id: 1 })];
    expect(removeMessage(chats, 1, 99).removed).toBeNull();
  });
});

describe("restoreMessage", () => {
  it("inserts the message back at its original position", () => {
    const base = [chat({ id: 1, messages: [message({ id: 1 }), message({ id: 3, text: "третье" })] })];
    const removed = { chatId: 1, index: 1, message: message({ id: 2, text: "второе" }) };
    const next = restoreMessage(base, removed);
    expect(next[0].messages.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(next[0].messages[1].text).toBe("второе");
    expect(next[0].preview).toBe("третье");
  });
});

describe("upsertChat", () => {
  it("prepends a new chat", () => {
    const chats = [chat({ id: 1 })];
    const next = upsertChat(chats, chat({ id: 2, remoteId: "remote-2" }));
    expect(next.map((item) => item.id)).toEqual([2, 1]);
  });

  it("merges an existing chat by remote id", () => {
    const chats = [chat({ id: 1, remoteId: "remote-1", preview: "старое" })];
    const next = upsertChat(chats, chat({ id: 1, remoteId: "remote-1", preview: "новое" }));
    expect(next).toHaveLength(1);
    expect(next[0].preview).toBe("новое");
  });
});

describe("togglePinned and markRead", () => {
  it("toggles pin state", () => {
    const chats = [chat({ id: 1 })];
    expect(togglePinned(chats, 1)[0].pinned).toBe(true);
    expect(togglePinned(togglePinned(chats, 1), 1)[0].pinned).toBe(false);
  });

  it("resets unread counter", () => {
    const chats = [chat({ id: 1, unread: 4 })];
    expect(markRead(chats, 1)[0].unread).toBe(0);
  });
});

describe("matchesChatFilter", () => {
  it("supports unread, pinned and group filters", () => {
    expect(matchesChatFilter(chat({ unread: 2 }), "unread")).toBe(true);
    expect(matchesChatFilter(chat({ pinned: true }), "pinned")).toBe(true);
    expect(matchesChatFilter(chat({ group: true }), "groups")).toBe(true);
    expect(matchesChatFilter(chat({}), "groups")).toBe(false);
    expect(matchesChatFilter(chat({}), "all")).toBe(true);
  });
});

describe("getGalleryImages", () => {
  it("collects image attachments with chat names", () => {
    const chats = [
      chat({ id: 1, name: "Аня", messages: [message({ attachment: { name: "a.png", type: "image/png", data: "x", size: 1 } }), message({ id: 2, attachment: { name: "b.pdf", type: "application/pdf", data: "x", size: 1 } })] }),
      chat({ id: 2, name: "Команда", messages: [message({ id: 3, attachment: { name: "c.jpg", type: "image/jpeg", data: "y", size: 2 } })] }),
    ];
    const images = getGalleryImages(chats);
    expect(images.map((item) => item.chatName)).toEqual(["Аня", "Команда"]);
    expect(images.map((item) => item.attachment?.name)).toEqual(["a.png", "c.jpg"]);
  });
});

describe("updateChat and mapMessagesByRemoteId", () => {
  it("updates only the target chat", () => {
    const chats = [chat({ id: 1, preview: "a" }), chat({ id: 2, preview: "b" })];
    const next = updateChat(chats, 2, (item) => ({ ...item, preview: "c" }));
    expect(next.map((item) => item.preview)).toEqual(["a", "c"]);
  });

  it("patches a message found by remote id", () => {
    const chats = [chat({ id: 1, messages: [message({ id: 1, remoteId: "r1" }), message({ id: 2, remoteId: "r2" })] })];
    const next = mapMessagesByRemoteId(chats, "r2", (item) => ({ ...item, text: "новый текст" }));
    expect(next[0].messages[1].text).toBe("новый текст");
    expect(next[0].messages[0].text).toBe("привет");
  });
});

describe("splitArchived", () => {
  const at = (overrides: Partial<Chat>): Chat =>
    ({
      id: 1,
      name: "Чат",
      avatar: "A",
      color: "blue",
      preview: "",
      time: "",
      messages: [],
      ...overrides,
    }) as Chat;

  it("puts ordinary chats in the active list", () => {
    const { active, archived } = splitArchived([at({ id: 1 }), at({ id: 2 })]);
    expect(active.map((c) => c.id)).toEqual([1, 2]);
    expect(archived).toEqual([]);
  });

  it("moves archived chats out of the main list", () => {
    const { active, archived } = splitArchived([at({ id: 1, archived: true }), at({ id: 2 })]);
    expect(active.map((c) => c.id)).toEqual([2]);
    expect(archived.map((c) => c.id)).toEqual([1]);
  });

  it("brings an archived chat back when something arrives in it", () => {
    // Holding a message in a folder nobody opens is worse than a small surprise.
    const { active, archived } = splitArchived([at({ id: 1, archived: true, unread: 1 })]);
    expect(active.map((c) => c.id)).toEqual([1]);
    expect(archived).toEqual([]);
  });

  it("keeps an archived chat archived while it has nothing new", () => {
    const { archived } = splitArchived([at({ id: 1, archived: true, unread: 0 })]);
    expect(archived.map((c) => c.id)).toEqual([1]);
  });

  it("handles an empty list", () => {
    expect(splitArchived([])).toEqual({ active: [], archived: [] });
  });
});
