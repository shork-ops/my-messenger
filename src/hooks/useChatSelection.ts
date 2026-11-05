/**
 * Opening and refreshing a conversation.
 *
 * Selecting a chat does five things at once and the order matters: the message list is marked
 * read before the server is asked, so a failed request does not leave an unread badge that
 * comes back. Then the conversation is refreshed from the server, because a websocket that
 * reconnected while the tab was hidden may have missed messages.
 */

import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Chat, Message } from "../types";
import { supabase } from "../lib/supabase";
import { applyReadStamp, markRead } from "../lib/chats";

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
  const current = useRef(deps); current.current=deps;
  const alive=useRef(true);
  const requests=useRef(new Map<string,number>());
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function refreshChatMessages(chat: Chat) {
    const owner=deps.accountId;
    const remoteId=chat.remoteId;
    if(!remoteId||!owner)return;
    const sequence=(requests.current.get(remoteId)??0)+1;
    requests.current.set(remoteId,sequence);
    const snapshot=current.current.chats.find(item=>item.remoteId===remoteId)?.messages??chat.messages;
    try {
    const {loadMessageSnapshot,reconcileMessageSnapshot}=await import("../lib/messageSnapshot");
    const messages=await loadMessageSnapshot({chatId:remoteId,accountId:owner,selfName:deps.profileName,authorName:"Собеседник"},snapshot.flatMap(message=>message.remoteId?[message.remoteId]:[]));
    if(!messages||!alive.current||current.current.accountId!==owner||requests.current.get(remoteId)!==sequence)return;
    deps.setChats(items=>items.map(item=>{
      if(item.remoteId!==remoteId)return item;
      const merged=reconcileMessageSnapshot(item.messages,snapshot,messages);
      const last=merged[merged.length-1];
      return {...item,messages:merged,preview:last?.text??"Начни общение",time:last?.time??""};
    }));
    } catch {
      // A failed lazy import leaves the current conversation available for retry.
    }
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
