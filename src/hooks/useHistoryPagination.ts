import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { canLoadOlder, olderThanCursor, prependOlderMessages } from "../lib/history";
import { DEFAULT_MESSAGE_PAGE_SIZE, loadOlderMessagePage } from "../lib/messageLoader";
import type { Chat } from "../types";

type UseHistoryPaginationOptions = {
  accountId: string | null;
  profileName: string;
  notify: (message: string) => void;
  setChats: Dispatch<SetStateAction<Chat[]>>;
};

/**
 * Loads older messages when the conversation is scrolled to the top.
 * Keyset pagination: at most one page in flight per chat, and the window stops at `historyExhausted`.
 */
export function useHistoryPagination({ accountId, profileName, notify, setChats }: UseHistoryPaginationOptions) {
  const [loadingChatIds, setLoadingChatIds] = useState<string[]>([]);
  const inFlight = useRef<Set<string>>(new Set());

  async function loadOlder(chat: Chat) {
    if (!accountId || !chat.remoteId || !chat.messages.length) return;
    if (inFlight.current.has(chat.remoteId) || chat.historyExhausted) return;
    const cursor = olderThanCursor(chat.messages);
    if (!cursor || !canLoadOlder(chat.messages, false, false)) return;
    inFlight.current.add(chat.remoteId);
    setLoadingChatIds((current) => [...current, chat.remoteId!]);
    try {
      const page = await loadOlderMessagePage({
        chatId: chat.remoteId,
        cursor,
        accountId,
        selfName: profileName,
        authorName: chat.name,
        pageSize: DEFAULT_MESSAGE_PAGE_SIZE,
      });
      if (page === null) {
        notify("Не удалось загрузить историю чата");
        return;
      }
      setChats((current) =>
        current.map((item) =>
          item.remoteId === chat.remoteId
            ? { ...item, messages: prependOlderMessages(item.messages, page), historyExhausted: page.length < DEFAULT_MESSAGE_PAGE_SIZE }
            : item
        )
      );
    } finally {
      inFlight.current.delete(chat.remoteId);
      setLoadingChatIds((current) => current.filter((id) => id !== chat.remoteId));
    }
  }

  return { loadOlder, loadingChatIds };
}

/**
 * Attaches a scroll listener that requests older history when the container reaches the top.
 * The first page is loaded at startup, so an older page is requested only after the user scrolls.
 */
export function useInfiniteHistory(
  scrollRef: { current: HTMLDivElement | null },
  chat: Chat,
  loadOlder: (chat: Chat) => void
) {
  const chatRef = useRef(chat);
  chatRef.current = chat;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      if (element.scrollTop > 120) return;
      const active = chatRef.current;
      if (active.remoteId && !active.historyExhausted) loadOlder(active);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [loadOlder, scrollRef]);
}
