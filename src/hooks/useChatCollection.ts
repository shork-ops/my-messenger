import { useEffect, useMemo, useState } from "react";
import type { Chat, ChatFilter } from "../types";
import {
  filterChats,
  getGalleryImages,
  getVisibleMessages,
  matchesChatFilter,
  sortChats,
  togglePinned,
} from "../lib/chats";
import { isDemoMode, demoSeedEnabled } from "../lib/constants";
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
    if (!window.localStorage.getItem("nexus-demo-chats-cleared-v1")) {
      window.localStorage.removeItem("nexus-chats-v1");
      window.localStorage.removeItem("nexus-drafts-v1");
      window.localStorage.setItem("nexus-demo-chats-cleared-v1", "1");
      return [];
    }
    try {
      const saved = window.localStorage.getItem("nexus-chats-v1");
      return saved ? (JSON.parse(saved) as Chat[]) : [];
    } catch {
      return [];
    }
  });
  const [activeId, setActiveId] = useState(1);
  const [drafts, setDrafts] = useState<Record<number, string>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("nexus-drafts-v1") || "{}") as Record<number, string>;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    window.localStorage.setItem("nexus-drafts-v1", JSON.stringify(drafts));
  }, [drafts]);

  useEffect(() => {
    try {
      window.localStorage.setItem("nexus-chats-v1", JSON.stringify(chats));
    } catch {
      // The app remains usable if browser storage is unavailable.
    }
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
  const displayChats = useMemo(
    () =>
      sortedChats.filter(
        (chat) => matchesChatFilter(chat, chatFilter) && (!search.trim() || filteredChats.some((item) => item.id === chat.id))
      ),
    [sortedChats, chatFilter, search, filteredChats]
  );
  const visibleMessages = useMemo(() => getVisibleMessages(activeChat.messages, messageSearch), [activeChat, messageSearch]);
  const galleryImages = useMemo(() => getGalleryImages(chats), [chats]);
  const unreadTotal = useMemo(() => chats.reduce((sum, chat) => sum + (chat.unread ?? 0), 0), [chats]);

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
    activeChat,
    displayChats,
    visibleMessages,
    galleryImages,
    unreadTotal,
    toggleChatPin,
  };
}
