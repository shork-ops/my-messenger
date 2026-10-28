import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../lib/supabase";
import { clockTime, numericId } from "../lib/format";
import { appendMessage, mapMessagesByRemoteId } from "../lib/chats";
import type { Chat, ChatMessageRow, Message } from "../types";

type UseRealtimeChatOptions = {
  accountId: string | null;
  remoteId?: string;
  setChats: Dispatch<SetStateAction<Chat[]>>;
};

export function useRealtimeChat({ accountId, remoteId, setChats }: UseRealtimeChatOptions) {
  useEffect(() => {
    const client = supabase;
    if (!client || !accountId || !remoteId) return;
    const channel = client
      .channel(`nexus-messages-${remoteId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `chat_id=eq.${remoteId}` }, async (payload) => {
        const row = payload.new as ChatMessageRow;
        if (!row?.id) return;
        let attachment: Message["attachment"];
        if (row.attachment) {
          let data = "";
          if (row.attachment.path) {
            const signed = await client.storage.from("chat-media").createSignedUrl(row.attachment.path, 3600);
            data = signed.data?.signedUrl || "";
          }
          attachment = {
            name: row.attachment.name || "Вложение",
            type: row.attachment.type || "application/octet-stream",
            size: row.attachment.size || 0,
            path: row.attachment.path,
            data,
          };
        }
        setChats((current) => {
          const chat = current.find((item) => item.remoteId === row.chat_id);
          if (!chat) return current;
          const existing = chat.messages.find((message) => message.remoteId === row.id);
          if (existing) {
            if (!row.poll) return current;
            return mapMessagesByRemoteId(current, row.id, (message) => ({ ...message, poll: row.poll as Message["poll"] }));
          }
          if (payload.eventType !== "INSERT" || row.sender_id === accountId) return current;
          const created = new Date(row.created_at);
          const message: Message = {
            id: numericId(row.id),
            remoteId: row.id,
            author: chat.name,
            text: row.deleted_at ? "Сообщение удалено" : row.body,
            time: clockTime(created),
            mine: false,
            createdAt: created.getTime(),
            edited: Boolean(row.edited_at),
            ...(row.effect ? { effect: row.effect } : {}),
            ...(row.poll ? { poll: row.poll as Message["poll"] } : {}),
            ...(attachment ? { attachment } : {}),
          };
          const preview = row.poll ? "📊 " + row.body : attachment ? "📎 " + row.body : message.text;
          return appendMessage(current, chat.id, message, preview, message.time);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, async (payload) => {
        const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as { message_id?: string };
        if (!row.message_id) return;
        const { data: reactions } = await client.from("message_reactions").select("emoji").eq("message_id", row.message_id);
        const emojis = (reactions ?? []).map((item) => item.emoji);
        setChats((current) => mapMessagesByRemoteId(current, row.message_id!, (message) => ({ ...message, reactions: emojis })));
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [accountId, remoteId, setChats]);
}
