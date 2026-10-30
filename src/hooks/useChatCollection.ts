import { useEffect, useMemo, useState } from "react";
import type { Chat, ChatFilter } from "../types";
import {
  filterChats,
  getGalleryImages,
  getVisibleMessages,
  matchesChatFilter,
  sortChats,
  splitArchived,
  togglePinned,
} from "../lib/chats";
import { attentionTotal } from "../lib/chatSettings";
import { isDemoMode, demoSeedEnabled } from "../lib/constants";
import { readItem, writeItem, removeItem } from "../lib/safeStorage";
import { createDemoSeedChats } from "../lib/demoSeed";

type UseChatCollectionOptions = {
  search: string;
  chatFilter: ChatFilter;
  messageSearch: string;
  notify: (message: string) => void;
};

const EMPTY_CHAT: Chat = {
  id: 0,
  name: "Новый чат",
  avatar: "＋",
  color: "blue",
  preview: "Создай чат или найди пользователя по username",
  time: "",
  messages: [],
};

export function useChatCollection({ search, chatFilter, messageSearch, notify }: UseChatCollectionOptions) {
  const [chats, setChats] = useState<Chat[]>(() => {
    // Browser tests need a deterministic starting state; ship no seed to users.
    if (demoSeedEnabled) return createDemoSeedChats();
    if (!isDemoMode) return [];
    if (!readItem("nexus-demo-chats-cleared-v1")) {
      removeItem("nexus-chats-v1");
      removeItem("nexus-drafts-v1");
      writeItem("nexus-demo-chats-cleared-v1", "1");
      return [];
    }
    try {
      const saved = readItem("nexus-chats-v1");
      const parsed: unknown = saved ? JSON.parse(saved) : null;
      // Storage is a cache, so anything unexpected in it is dropped rather than trusted:
      // a corrupted list must not take the app down with it.
      return Array.isArray(parsed) ? (parsed as Chat[]) : [];
    } catch {
      return [];
    }
  });
  const [activeId, setActiveId] = useState(1);
  const [drafts, setDrafts] = useState<Record<number, string>>(() => {
    try {
      const parsed: unknown = JSON.parse(readItem("nexus-drafts-v1") || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<number, string>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    writeItem("nexus-drafts-v1", JSON.stringify(drafts));
  }, [drafts]);

  // The message a draft is answering. Kept beside the drafts because the two are read and
  // written together: a reply target without its text, or text without its target, is a
  // state the composer cannot show.
  const [replyDrafts, setReplyDrafts] = useState<Record<number, { author: string; text: string }>>(() => {
    try {
      const parsed: unknown = JSON.parse(readItem("nexus-reply-drafts-v1") || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<number, { author: string; text: string }>)
        : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    writeItem("nexus-reply-drafts-v1", JSON.stringify(replyDrafts));
  }, [replyDrafts]);

  useEffect(() => {
    writeItem("nexus-chats-v1", JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    if (chats.length > 0 && !chats.some((chat) => chat.id === activeId)) setActiveId(chats[0].id);
  }, [chats, activeId]);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeId) ?? chats[0] ?? EMPTY_CHAT,
    [chats, activeId]
  );
  const sortedChats = useMemo(() => sortChats(chats), [chats]);
  const filteredChats = useMemo(() => filterChats(chats, search), [chats, search]);
  // Archived chats leave the main list on their own rather than through a filter:
  // they are not hidden by a view, they moved.
  const { active: liveChats, archived: archivedChats } = useMemo(() => splitArchived(sortedChats), [sortedChats]);
  const displayChats = useMemo(() => {
    const pool = chatFilter === "archive" ? archivedChats : liveChats;
    return pool.filter(
      (chat) =>
        (chatFilter === "archive" || matchesChatFilter(chat, chatFilter)) &&
        (!search.trim() || filteredChats.some((item) => item.id === chat.id))
    );
  }, [liveChats, archivedChats, chatFilter, search, filteredChats]);
  const visibleMessages = useMemo(() => getVisibleMessages(activeChat.messages, messageSearch), [activeChat, messageSearch]);
  const galleryImages = useMemo(() => getGalleryImages(chats), [chats]);
  // Muted and archived chats keep their own counts in the list but stay out of the
  // total: a badge that counts chats you silenced on purpose trains people to
  // ignore the badge.
  const unreadTotal = useMemo(() => attentionTotal(chats, new Date()), [chats]);

  function toggleChatPin(chat: Chat) {
    setChats((current) => togglePinned(current, chat.id));
    notify(chat.pinned ? "Чат откреплён" : "Чат закреплён");
  }

  return {
    chats,
    setChats,
    activeId,
    setActiveId,
    drafts,
    setDrafts,
    replyDrafts,
    setReplyDrafts,
    activeChat,
    displayChats,
    visibleMessages,
    galleryImages,
    unreadTotal,
    archivedChats,
    toggleChatPin,
  };
}
