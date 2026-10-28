import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../lib/supabase";
import { appendMessage, applyRemoteMemberRead, mapMessagesByRemoteId } from "../lib/chats";
import { mapMessageRow } from "../lib/messageSync";
import type { Chat, ChatMessageRow, Message } from "../types";

type UseRealtimeChatOptions = {
  accountId: string | null;
  profileName: string;
  remoteId?: string;
  setChats: Dispatch<SetStateAction<Chat[]>>;
};

export function useRealtimeChat({ accountId, profileName, remoteId, setChats }: UseRealtimeChatOptions) {
  useEffect(() => {
    const client = supabase;
    if (!client || !accountId || !remoteId) return;
    const channel = client
      .channel(`nexus-messages-${remoteId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `chat_id=eq.${remoteId}` }, async (payload) => {
        const row = payload.new as ChatMessageRow;
        if (!row?.id) return;
        // Inbound INSERTs become new bubbles; everything else only refreshes an existing message (e.g. a poll).
        if (payload.eventType === "INSERT" && row.sender_id !== accountId) {
          const message = await mapMessageRow(row, { accountId, selfName: profileName, authorName: "Собеседник" });
          if (!message) return;
          setChats((current) => {
            const chat = current.find((item) => item.remoteId === row.chat_id);
            if (!chat || chat.messages.some((entry) => entry.remoteId === row.id)) return current;
            const preview = row.poll ? "📊 " + row.body : message.attachment ? "📎 " + message.text : message.text;
            return appendMessage(current, chat.id, message, preview, message.time);
          });
          const marked = await client.rpc("mark_chat_read", { target_chat_id: row.chat_id });
          if (typeof marked.data === "string") {
            const at = Date.parse(marked.data);
            if (!Number.isNaN(at)) setChats((current) => applyRemoteMemberRead(current, row.chat_id, accountId, at, accountId));
          }
          return;
        }
        const updatedPoll = row.poll as Message["poll"] | null | undefined;
        if (!updatedPoll) return;
        setChats((current) => mapMessagesByRemoteId(current, row.id, (message) => ({ ...message, poll: updatedPoll })));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_members", filter: `chat_id=eq.${remoteId}` }, (payload) => {
        const row = payload.new as { user_id?: string; last_read_at?: string | null };
        if (!row?.user_id || !row.last_read_at) return;
        const at = Date.parse(row.last_read_at);
        if (Number.isNaN(at)) return;
        setChats((current) => applyRemoteMemberRead(current, remoteId, row.user_id!, at, accountId));
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
  }, [accountId, profileName, remoteId, setChats]);
}
