import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../lib/supabase";
import { appendMessage, applyRemoteMemberRead, mapMessagesByRemoteId, planRealtimeMessage } from "../lib/chats";
import { mapMessageRow } from "../lib/messageSync";
import { canMarkRead } from "../lib/readState";
import type { Chat, ChatMessageRow, Message, MessageEffect } from "../types";

type UseRealtimeChatOptions = {
  accountId: string | null;
  profileName: string;
  remoteId?: string;
  setChats: Dispatch<SetStateAction<Chat[]>>;
  /**
   * Whether this conversation is on screen for the reader. A message that arrives while
   * the chat is not being looked at has not been read.
   */
  visible: { chatOpen: boolean; conversationOnScreen: boolean; documentVisible: boolean };
  /** Called when an event arrives for a chat that is not loaded yet. */
  onMissingChat?: (chatId: string) => Promise<void> | void;
};

export function useRealtimeChat({ accountId, profileName, remoteId, setChats, visible, onMissingChat }: UseRealtimeChatOptions) {
  // The callback is held in a ref so that passing an inline arrow function does
  // not tear down and rebuild the subscription on every render. Doing that made
  // the channel re-join constantly, and events that arrived during a re-join were
  // lost.
  const onMissingChatRef = useRef(onMissingChat);
  onMissingChatRef.current = onMissingChat;
  // Read inside the subscription, which is not rebuilt when the reader moves between
  // chats: a ref keeps it a value that is current rather than one from the first render.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

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
          let chatMissing = false;
          setChats((current) => {
            const plan = planRealtimeMessage(current, row.chat_id, row.id);
            // The chat list has not finished loading, or this chat appeared after
            // the last fetch. Dropping the event loses the message silently, so
            // the list is reloaded instead.
            if (plan.action === "reload") {
              chatMissing = true;
              return current;
            }
            if (plan.action === "skip") return current;
            const preview = row.poll ? "📊 " + row.body : message.attachment ? "📎 " + message.text : message.text;
            return appendMessage(current, plan.chatId, message, preview, message.time);
          });
          if (chatMissing) await onMissingChatRef.current?.(row.chat_id);
          // Read receipts are the reader's statement that they have seen it. Only a
          // conversation that is actually on screen counts; anything else stays unread.
          if (!canMarkRead(visibleRef.current)) return;
          const marked = await client.rpc("mark_chat_read", { target_chat_id: row.chat_id });
          if (typeof marked.data === "string") {
            const at = Date.parse(marked.data);
            if (!Number.isNaN(at)) setChats((current) => applyRemoteMemberRead(current, row.chat_id, accountId, at, accountId));
          }
          return;
        }
        // An update can carry any field the other side changed, and only the poll was read
        // here. A message effect, an edit or a new pin therefore never reached the recipient:
        // the database held the new value while the open conversation showed the old one.
        // Only fields present in the payload are applied, so an event that omits one does
        // not wipe it on this side.
        const rowExtra = row as { effect?: MessageEffect | null; body?: string; edited?: boolean | null };
        const patch: Partial<Message> = {};
        if (row.poll !== undefined) patch.poll = (row.poll as Message["poll"] | null) ?? undefined;
        if (rowExtra.effect !== undefined) patch.effect = rowExtra.effect ?? undefined;
        if (rowExtra.body !== undefined) patch.text = rowExtra.body;
        if (rowExtra.edited !== undefined) patch.edited = rowExtra.edited ?? false;
        if (Object.keys(patch).length === 0) return;
        setChats((current) => mapMessagesByRemoteId(current, row.id, (message) => ({ ...message, ...patch })));
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
