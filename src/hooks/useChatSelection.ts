/**
 * Opening and refreshing a conversation.
 *
 * Selecting a chat does five things at once and the order matters: the message list is marked
 * read before the server is asked, so a failed request does not leave an unread badge that
 * comes back. Then the conversation is refreshed from the server, because a websocket that
 * reconnected while the tab was hidden may have missed messages.
 */

import type { Dispatch, SetStateAction } from "react";
import type { Chat, Message } from "../types";
import { supabase } from "../lib/supabase";
import { applyReadStamp, markRead } from "../lib/chats";
import { loadMessagePage } from "../lib/messageLoader";

export type MobileView = "list" | "chat";

export function useChatSelection(deps: {
  accountId: string | null;
  profileName: string;
  chats: Chat[];
  setChats: Dispatch<SetStateAction<Chat[]>>;
  setActiveId: Dispatch<SetStateAction<number>>;
  setMobileView: Dispatch<SetStateAction<MobileView>>;
  setOpenedChatId: Dispatch<SetStateAction<number | null>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setMessageSearch: Dispatch<SetStateAction<string>>;
  draftsRef: { current: Record<number, string> };
}) {
  /**
   * Pulls the newest page from the server and merges it into the open conversation.
   *
   * Realtime is the fast path for incoming messages, but it can be unavailable - server
   * outage, blocked websocket, backgrounded tab - so this keeps the open conversation
   * correct in that case.
   */
  async function refreshChatMessages(chat: Chat) {
    if (!chat.remoteId || !deps.accountId) return;
    const messages: Message[] | null = await loadMessagePage({
      chatId: chat.remoteId,
      accountId: deps.accountId,
      selfName: deps.profileName,
      authorName: "Собеседник",
    });
    if (!messages || !messages.length) return;
    deps.setChats((current) =>
      current.map((item) => {
        if (item.id !== chat.id) return item;
        // Merge by remote id so locally appended messages are not duplicated.
        const known = new Set(item.messages.map((message) => message.remoteId).filter(Boolean));
        const merged = [...item.messages, ...messages.filter((message) => !known.has(message.remoteId))];
        merged.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
        const last = merged[merged.length - 1];
        return { ...item, messages: merged, preview: last?.text ?? item.preview, time: last?.time ?? item.time };
      })
    );
  }

  async function selectChat(chat: Chat) {
    deps.setActiveId(chat.id);
    deps.setOpenedChatId(chat.id);
    deps.setMobileView("chat");
    if (window.matchMedia("(max-width: 760px)").matches) window.history.pushState({ nexusChat: chat.id }, "");
    deps.setDraft(deps.draftsRef.current[chat.id] ?? "");
    deps.setMessageSearch("");
    // Marked read locally first: a failed request must not leave a badge that comes back.
    deps.setChats((current) => markRead(current, chat.id));

    const client = supabase;
    if (!client || !deps.accountId || !chat.remoteId) return;
    void refreshChatMessages(chat);
    const { data, error } = await client.rpc("mark_chat_read", { target_chat_id: chat.remoteId });
    if (error || typeof data !== "string") return;
    const stamped = Date.parse(data);
    if (Number.isNaN(stamped)) return;
    deps.setChats((current) => applyReadStamp(current, chat.id, deps.accountId!, stamped));
  }

  return { selectChat, refreshChatMessages };
}
