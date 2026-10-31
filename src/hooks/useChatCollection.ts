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
import { scopedStore } from "../lib/scopedStorage";

type UseChatCollectionOptions = {
  search: string;
  chatFilter: ChatFilter;
  messageSearch: string;
  notify: (message: string) => void;
  /**
   * Whose chats and drafts these are.
   *
   * Required, and deliberately not defaulted: a caller that forgets it would fall back to the
   * guest namespace, which is a separate bug from the one this parameter exists to prevent, but
   * at least it cannot silently share one person's drafts with another.
   */
  accountId: string | null;
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

/** A stored JSON object of records, or an empty one if it is missing or damaged. */
function readJsonRecord<T extends object>(raw: string | null): T {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as T;
  } catch {
    return {} as T;
  }
}

export function useChatCollection({ search, chatFilter, messageSearch, notify, accountId }: UseChatCollectionOptions) {
  // Every read and write below goes through this, so drafts, reply targets and the cached chat
  // list are stored inside one account's namespace and never in the shared one.
  const store = useMemo(() => scopedStore(accountId), [accountId]);

  const [chats, setChats] = useState<Chat[]>(() => {
    // Browser tests need a deterministic starting state; ship no seed to users.
    if (demoSeedEnabled) return createDemoSeedChats();
    if (!isDemoMode) return [];
    if (!store.read("nexus-demo-chats-cleared-v1")) {
      store.remove("nexus-chats-v1");
      store.remove("nexus-drafts-v1");
      store.write("nexus-demo-chats-cleared-v1", "1");
      return [];
    }
    try {
      const saved = store.read("nexus-chats-v1");
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
      const parsed: unknown = JSON.parse(store.read("nexus-drafts-v1") || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<number, string>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    store.write("nexus-drafts-v1", JSON.stringify(drafts));
  }, [drafts, store]);

  // The message a draft is answering. Kept beside the drafts because the two are read and
  // written together: a reply target without its text, or text without its target, is a
  // state the composer cannot show.
  const [replyDrafts, setReplyDrafts] = useState<Record<number, { author: string; text: string }>>(() => {
    try {
      const parsed: unknown = JSON.parse(store.read("nexus-reply-drafts-v1") || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<number, { author: string; text: string }>)
        : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    store.write("nexus-reply-drafts-v1", JSON.stringify(replyDrafts));
  }, [replyDrafts, store]);

  useEffect(() => {
    store.write("nexus-chats-v1", JSON.stringify(chats));
  }, [chats, store]);

  // Switching accounts replaces the cached collection with the new owner's, rather than leaving
  // the previous account's chats on screen until the server answers. The initialisers above only
  // run on mount, so without this the screen would keep showing A after a switch to B.
  useEffect(() => {
    setChats((current) => {
      if (isDemoMode && demoSeedEnabled) return current;
      try {
        const saved = store.read("nexus-chats-v1");
        const parsed: unknown = saved ? JSON.parse(saved) : null;
        return Array.isArray(parsed) ? (parsed as Chat[]) : [];
      } catch {
        return [];
      }
    });
    setDrafts(readJsonRecord<Record<number, string>>(store.read("nexus-drafts-v1")));
    setReplyDrafts(readJsonRecord<Record<number, { author: string; text: string }>>(store.read("nexus-reply-drafts-v1")));
    // `store` changes identity only when the account changes, which is what this is for.
  }, [store]);

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
