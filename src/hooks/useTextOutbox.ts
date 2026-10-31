import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../lib/supabase";
import { numericId, clockTime } from "../lib/format";
import { sendText } from "../lib/sendText";
import { placeNewMessage } from "../lib/messageOrder";
import { updateChat } from "../lib/chats";
import type { Chat, Message, ReplyPreview } from "../types";
import { readItem, writeItem } from "../lib/safeStorage";

type Pending = { chatId: number; remoteChatId: string; senderId: string; message: Message; uuid: string; body?: string };

export function useTextOutbox({ accountId, profileName, chats, setChats }: {
  accountId: string | null; profileName: string; chats: Chat[]; setChats: Dispatch<SetStateAction<Chat[]>>;
}) {
  const current = useRef({ accountId, chats });
  current.current = { accountId, chats };
  const pending = useRef(new Map<number, Pending>());
  const running = useRef(new Set<number>());
  const persist = () => {
    if (current.current.accountId) writeItem(`nexus-outbox:${current.current.accountId}`, JSON.stringify([...pending.current.values()]));
  };
  useEffect(() => {
    pending.current.clear(); running.current.clear();
    if (!accountId) return;
    try {
      const saved = JSON.parse(readItem(`nexus-outbox:${accountId}`) || "[]");
      if (Array.isArray(saved)) for (const entry of saved.slice(-100)) {
        if (entry?.senderId !== accountId || typeof entry.uuid !== "string" || typeof entry.message?.text !== "string" || typeof entry.chatId !== "number" || typeof entry.remoteChatId !== "string") continue;
        entry.message.delivery = "failed";
        pending.current.set(entry.message.id, entry);
      }
    } catch { /* A corrupt local cache must not prevent signing in. */ }
  }, [accountId]);
  useEffect(() => {
    if (!accountId || pending.current.size === 0) return;
    setChats(all => {
      let changed = false;
      const next = all.map(chat => {
        let messages = chat.messages;
        for (const entry of pending.current.values()) {
          if (entry.senderId !== accountId || entry.remoteChatId !== chat.remoteId || messages.some(m => m.remoteId === entry.uuid)) continue;
          const cached = messages.find(m => m.id === entry.message.id);
          if (cached) {
            if (!running.current.has(entry.message.id) && cached.delivery !== entry.message.delivery) {
              changed = true;
              messages = messages.map(m => m.id === entry.message.id ? { ...m, delivery: entry.message.delivery } : m);
            }
            continue;
          }
          changed = true;
          messages = placeNewMessage(messages, entry.message);
        }
        return messages === chat.messages ? chat : { ...chat, messages };
      });
      return changed ? next : all;
    });
  }, [accountId, chats, setChats]);
  const retryMessage = useCallback(async (id: number) => {
    const entry = pending.current.get(id);
    if (!entry || running.current.has(id) || !supabase || current.current.accountId !== entry.senderId) return;
    running.current.add(id);
    const patch = (delivery: Message["delivery"]) => {
      if (current.current.accountId !== entry.senderId) return;
      entry.message = { ...entry.message, delivery };
      persist();
      setChats((all) => updateChat(all, entry.chatId, (chat) => ({ ...chat, messages: chat.messages.map(m => m.id === id ? { ...m, delivery } : m) })));
    };
    patch("sending");
    try {
      const row = await sendText(supabase, { id: entry.uuid, chat_id: entry.remoteChatId, sender_id: entry.senderId, body: entry.body ?? entry.message.text });
      if (current.current.accountId !== entry.senderId) return;
      const sent = { ...entry.message, remoteId: row.id, createdAt: Date.parse(row.created_at), time: clockTime(new Date(row.created_at)), delivery: "sent" as const };
      setChats((all) => updateChat(all, entry.chatId, (chat) => ({ ...chat, messages: placeNewMessage(chat.messages.filter(m => m.id !== id && m.remoteId !== row.id), sent) })));
      pending.current.delete(id);
      persist();
    } catch { patch("failed"); }
    finally { running.current.delete(id); }
  }, [setChats]);
  const queueText = useCallback((chat: Chat, text: string, replyTo?: ReplyPreview, options?: { body: string; stickerId: string }) => {
    if (!accountId || !chat.remoteId) return;
    const uuid = crypto.randomUUID();
    const now = Date.now();
    const message: Message = { id: numericId(uuid), author: profileName, text, mine: true, createdAt: now, time: clockTime(new Date(now)), replyTo, delivery: "sending", ...(options ? { stickerId: options.stickerId } : {}) };
    pending.current.set(message.id, { chatId: chat.id, remoteChatId: chat.remoteId, senderId: accountId, message, uuid, body: options?.body });
    persist();
    setChats((all) => updateChat(all, chat.id, (item) => ({ ...item, preview: text, time: message.time, messages: [...item.messages, message] })));
    void retryMessage(message.id);
  }, [accountId, profileName, retryMessage, setChats]);
  return { queueText, retryMessage };
}
