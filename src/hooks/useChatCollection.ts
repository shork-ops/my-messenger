import { accountStorageKey, useStoredState } from "./useStoredState";
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
import { chatsForStorage } from "../lib/disappearing";

type UseChatCollectionOptions = {
  accountId?: string | null;
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

function parseDrafts(raw: string | null): Record<number,string> {
  try {const value=JSON.parse(raw||"{}");return value && typeof value==="object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([,text])=>typeof text==="string")) as Record<number,string> : {};} catch{return {};}
}
function parseReplyDrafts(raw: string | null): Record<number,{author:string;text:string}> {
  try {const value=JSON.parse(raw||"{}");return value && typeof value==="object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([,entry])=>entry && typeof entry==="object" && typeof (entry as {author?:unknown}).author==="string" && typeof (entry as {text?:unknown}).text==="string")) as Record<number,{author:string;text:string}> : {};} catch{return {};}
}

export function useChatCollection({ accountId, search, chatFilter, messageSearch, notify }: UseChatCollectionOptions) {
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
      // A message whose time ran out while the app was closed is not brought back.
      return Array.isArray(parsed) ? chatsForStorage(parsed as Chat[], Date.now()) : [];
    } catch {
      return [];
    }
  });
  const [activeId, setActiveId] = useState(1);
  const scope = isDemoMode ? undefined : accountId ?? null;
  const [drafts, setDrafts] = useStoredState(accountStorageKey("nexus-drafts-v1",scope),parseDrafts);
  const [replyDrafts, setReplyDrafts] = useStoredState(accountStorageKey("nexus-reply-drafts-v1",scope),parseReplyDrafts);

  useEffect(() => {
    // Only chats that exist on this device alone are kept here. Cloud conversations live on
    // the server and the list is never read back from this copy outside demo mode, so a
    // copy would only be a full transcript left in the browser after signing out.
    if (!isDemoMode) {
      removeItem("nexus-chats-v1");
      return;
    }
    const localOnly = chats.filter((chat) => !chat.remoteId);
    writeItem("nexus-chats-v1", JSON.stringify(chatsForStorage(localOnly, Date.now())));
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
