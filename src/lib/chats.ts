import type { Chat, Message } from "../types";

export function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}

export function filterChats(chats: Chat[], query: string): Chat[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return chats;
  return chats.filter(
    (chat) =>
      chat.name.toLowerCase().includes(normalized) ||
      chat.preview.toLowerCase().includes(normalized) ||
      chat.messages.some((message) => message.text.toLowerCase().includes(normalized))
  );
}

export function getVisibleMessages(messages: Message[], query: string): Message[] {
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  if (!normalized) return messages;
  return messages.filter(
    (message) =>
      message.text.toLocaleLowerCase("ru-RU").includes(normalized) ||
      message.author.toLocaleLowerCase("ru-RU").includes(normalized)
  );
}

export function getGalleryImages(chats: Chat[]): (Message & { chatName: string })[] {
  return chats.flatMap((chat) =>
    chat.messages
      .filter((message) => message.attachment?.type.startsWith("image/"))
      .map((message) => ({ ...message, chatName: chat.name }))
  );
}

export function matchesChatFilter(chat: Chat, filter: "all" | "unread" | "pinned" | "groups"): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return Boolean(chat.unread);
  if (filter === "pinned") return Boolean(chat.pinned);
  return Boolean(chat.group);
}

export function updateChat(chats: Chat[], chatId: number, updater: (chat: Chat) => Chat): Chat[] {
  return chats.map((chat) => (chat.id === chatId ? updater(chat) : chat));
}

export function mapMessages(chats: Chat[], chatId: number, updater: (message: Message) => Message): Chat[] {
  return updateChat(chats, chatId, (chat) => ({ ...chat, messages: chat.messages.map(updater) }));
}

export function mapMessagesByRemoteId(chats: Chat[], remoteId: string, updater: (message: Message) => Message): Chat[] {
  return chats.map((chat) =>
    chat.messages.some((message) => message.remoteId === remoteId)
      ? { ...chat, messages: chat.messages.map((message) => (message.remoteId === remoteId ? updater(message) : message)) }
      : chat
  );
}

export function appendMessage(
  chats: Chat[],
  chatId: number,
  message: Message,
  preview: string = message.text,
  time: string = message.time
): Chat[] {
  return updateChat(chats, chatId, (chat) => ({
    ...chat,
    preview,
    time,
    messages: [...chat.messages, message],
  }));
}

export function removeMessage(
  chats: Chat[],
  chatId: number,
  messageId: number
): { chats: Chat[]; removed: { chatId: number; message: Message; index: number } | null } {
  const chat = chats.find((item) => item.id === chatId);
  const index = chat ? chat.messages.findIndex((message) => message.id === messageId) : -1;
  if (!chat || index < 0) return { chats, removed: null };
  const message = chat.messages[index];
  const wasLast = chat.messages[chat.messages.length - 1]?.id === messageId;
  const messages = chat.messages.filter((entry) => entry.id !== messageId);
  const last = messages[messages.length - 1];
  return {
    removed: { chatId, message, index },
    chats: updateChat(chats, chatId, (item) => ({
      ...item,
      messages,
      preview: wasLast ? last?.text ?? "Нет сообщений" : item.preview,
      time: wasLast ? last?.time ?? "" : item.time,
    })),
  };
}

export function restoreMessage(
  chats: Chat[],
  removed: { chatId: number; message: Message; index: number }
): Chat[] {
  return updateChat(chats, removed.chatId, (chat) => {
    const messages = [...chat.messages];
    messages.splice(Math.min(removed.index, messages.length), 0, removed.message);
    const last = messages[messages.length - 1];
    return { ...chat, messages, preview: last?.text ?? "Нет сообщений", time: last?.time ?? "" };
  });
}

export function upsertChat(chats: Chat[], chat: Chat): Chat[] {
  const exists = chats.some((item) => (chat.remoteId && item.remoteId === chat.remoteId) || item.id === chat.id);
  return exists
    ? chats.map((item) => ((chat.remoteId && item.remoteId === chat.remoteId) || item.id === chat.id ? { ...item, ...chat } : item))
    : [chat, ...chats];
}

/** Replaces the loaded message window of a chat (used by history pagination). */
export function setChatHistory(chats: Chat[], chatId: number, messages: Message[]): Chat[] {
  return updateChat(chats, chatId, (chat) => {
    const last = messages[messages.length - 1];
    return {
      ...chat,
      messages,
      ...(last ? { preview: last.text, time: last.time } : {}),
    };
  });
}

/** Drops the oldest loaded messages so memory stays bounded while scrolling. */
export function trimHistory(chats: Chat[], chatId: number, maxMessages: number): Chat[] {
  return updateChat(chats, chatId, (chat) =>
    chat.messages.length <= maxMessages ? chat : { ...chat, messages: chat.messages.slice(chat.messages.length - maxMessages) }
  );
}

export function togglePinned(chats: Chat[], chatId: number): Chat[] {
  return updateChat(chats, chatId, (chat) => ({ ...chat, pinned: !chat.pinned }));
}

export function markRead(chats: Chat[], chatId: number): Chat[] {
  return updateChat(chats, chatId, (chat) => ({ ...chat, unread: 0 }));
}

export function applyReadStamp(chats: Chat[], chatId: number, userId: string, at: number): Chat[] {
  return updateChat(chats, chatId, (chat) => ({
    ...chat,
    lastReadAt: Math.max(chat.lastReadAt ?? 0, at),
    memberReadAt: { ...(chat.memberReadAt ?? {}), [userId]: Math.max(chat.memberReadAt?.[userId] ?? 0, at) },
  }));
}

export function applyRemoteMemberRead(chats: Chat[], remoteId: string, userId: string, at: number, selfId: string | null): Chat[] {
  return chats.map((chat) => {
    if (chat.remoteId !== remoteId) return chat;
    return {
      ...chat,
      ...(userId === selfId ? { lastReadAt: Math.max(chat.lastReadAt ?? 0, at) } : {}),
      memberReadAt: { ...(chat.memberReadAt ?? {}), [userId]: Math.max(chat.memberReadAt?.[userId] ?? 0, at) },
    };
  });
}
