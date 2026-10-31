/**
 * Sending a message from the composer.
 *
 * Two paths that look alike and are not. A stored conversation hands the text to the outbox,
 * which retries it and reports delivery; a local conversation appends straight to the list.
 * Editing an existing message is a third path with its own server call.
 *
 * All three live here because they share one rule: the composer is cleared only after the
 * message has been accepted somewhere. Clearing first loses what a person typed when the
 * send fails, and that has happened in enough messengers to be worth stating.
 */

import { useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { Chat, Message } from "../types";
import { supabase } from "../lib/supabase";
import { updateChat } from "../lib/chats";
import { placeNewMessage } from "../lib/messageOrder";
import { exceedsMessageLimit, MESSAGE_TOO_LONG } from "../lib/messageLimits";
import { clockTime, numericId } from "../lib/format";
import { stickerById, stickerMarkup } from "../lib/stickers";
import { formatSendAt } from "../lib/scheduling";
import { sendText } from "../lib/sendText";

export type ReplyTarget = Pick<Message, "author" | "text"> | null;

export function useComposer(deps: {
  accountId: string | null;
  profileName: string;
  activeId: number;
  chats: Chat[];
  setChats: Dispatch<SetStateAction<Chat[]>>;
  notify: (text: string) => void;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  setDrafts: Dispatch<SetStateAction<Record<number, string>>>;
  replyTarget: ReplyTarget;
  replyDrafts: Record<number, { author: string; text: string }>;
  setReplyDrafts: Dispatch<SetStateAction<Record<number, { author: string; text: string }>>>;
  setReplyTarget: Dispatch<SetStateAction<Message | null>>;
  /** Hands the text to the outbox, which owns delivery and retries. */
  queueText: (
    chat: Chat,
    text: string,
    replyTo?: { author: string; text: string },
    options?: { body: string; stickerId: string }
  ) => void;
  setStickerOpen: Dispatch<SetStateAction<boolean>>;
  setScheduleOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  function clearComposer() {
    deps.setDraft("");
    deps.setDrafts((current) => ({ ...current, [deps.activeId]: "" }));
    deps.setReplyDrafts((current) => ({ ...current, [deps.activeId]: { author: "", text: "" } }));
    deps.setReplyTarget(null);
  }

  /** Saves an edit to a message that already exists. */
  async function saveEdit(text: string) {
    const editingChat = deps.chats.find((chat) => chat.id === deps.activeId);
    const editingMessage = editingChat?.messages.find((message) => message.id === editingMessageId);
    if (editingChat?.remoteId && editingMessage?.remoteId) {
      if (!supabase) {
        deps.notify("Нет подключения к Supabase");
        return;
      }
      const { error } = await supabase
        .from("messages")
        .update({ body: text, edited_at: new Date().toISOString() })
        .eq("id", editingMessage.remoteId)
        .eq("sender_id", deps.accountId);
      if (error) {
        deps.notify("Не удалось изменить сообщение в облаке");
        return;
      }
    }
    deps.setChats((current) =>
      updateChat(current, deps.activeId, (chat) => ({
        ...chat,
        preview: chat.messages[chat.messages.length - 1]?.id === editingMessageId ? text : chat.preview,
        messages: chat.messages.map((message) =>
          message.id === editingMessageId ? { ...message, text, edited: true } : message
        ),
      }))
    );
    setEditingMessageId(null);
    setEditDraft("");
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (editingMessageId !== null) {
      const text = editDraft.trim();
      if (!text) return;
      if (exceedsMessageLimit(text)) {
        deps.notify(MESSAGE_TOO_LONG);
        return;
      }
      await saveEdit(text);
      return;
    }

    const text = deps.draft.trim();
    if (!text) return;
    if (exceedsMessageLimit(text)) {
      deps.notify(MESSAGE_TOO_LONG);
      return;
    }
    // The server's clock decides the order, so its timestamp is what gets stored. Falling back
    // to this device is only for chats that live in this browser.
    const createdAt = Date.now();
    const replyTo = deps.replyTarget ? { author: deps.replyTarget.author, text: deps.replyTarget.text } : undefined;
    const targetChat = deps.chats.find((chat) => chat.id === deps.activeId);
    const client = supabase;

    if (targetChat?.remoteId) {
      if (!client || !deps.accountId) {
        deps.notify("Нужно войти в аккаунт, чтобы отправить сообщение");
        return;
      }
      // The outbox owns delivery; it retries and reports, so the composer is cleared now.
      deps.queueText(targetChat, text, replyTo);
      clearComposer();
      return;
    }
    if (client && deps.accountId) {
      deps.notify("Этот чат локальный. Начни переписку, выбрав пользователя по @username.");
      return;
    }

    const message: Message = {
      id: createdAt,
      author: deps.profileName,
      text,
      time: clockTime(new Date(createdAt)),
      mine: true,
      createdAt,
      ...(replyTo ? { replyTo } : {}),
    };
    // Placed by timestamp rather than appended: the server's clock may put this message just
    // before the newest one already on screen.
    deps.setChats((current) =>
      updateChat(current, deps.activeId, (chat) => ({
        ...chat,
        preview: message.text,
        time: message.time,
        messages: placeNewMessage(chat.messages, message),
      }))
    );
    clearComposer();
  }


  async function sendSticker(stickerId: string) {
    const sticker = stickerById(stickerId);
    if (!sticker) return;
    const targetChat = deps.chats.find((chat) => chat.id === deps.activeId);
    const client = supabase;
    if (targetChat?.remoteId) {
      if (!client || !deps.accountId) {
        deps.notify("Нужно войти в аккаунт, чтобы отправить стикер");
        return;
      }
      deps.queueText(targetChat, sticker.label, undefined, { body: stickerMarkup(stickerId), stickerId });
      deps.setStickerOpen(false);
      return;
    }
    if (client && deps.accountId) {
      deps.notify("Этот чат локальный. Начни переписку, выбрав пользователя по @username.");
      return;
    }
    const createdAt = Date.now();
    const message: Message = {
      id: createdAt,
      author: deps.profileName,
      text: sticker.label,
      time: clockTime(new Date(createdAt)),
      mine: true,
      createdAt,
      stickerId,
    };
    deps.setChats((current) =>
      updateChat(current, deps.activeId, (chat) => ({
        ...chat,
        preview: `Стикер: ${sticker.label}`,
        time: message.time,
        messages: placeNewMessage(chat.messages, message),
      }))
    );
    deps.setStickerOpen(false);
  }

  /**
   * Sends the draft at a later moment.
   *
   * Local chats live in this browser, so there is nowhere to keep a moment the browser cannot
   * outlive. Saying so is better than accepting the message and losing it.
   */
  async function scheduleMessage(at: Date, stickerId?: string) {
    const sticker = stickerId ? stickerById(stickerId) : undefined;
    const text = sticker ? sticker.label : deps.draft.trim();
    if (!text) return;
    const targetChat = deps.chats.find((chat) => chat.id === deps.activeId);
    const client = supabase;
    if (!targetChat?.remoteId) {
      deps.notify("Отложенная отправка работает в облачных чатах");
      deps.setScheduleOpen(false);
      return;
    }
    if (!client || !deps.accountId) {
      deps.notify("Нужно войти в аккаунт, чтобы отправить позже");
      deps.setScheduleOpen(false);
      return;
    }
    const body = sticker ? stickerMarkup(sticker.id) : text;
    const inserted = await sendText(client, {
      id: crypto.randomUUID(),
      chat_id: targetChat.remoteId,
      sender_id: deps.accountId,
      body,
      send_at: at.toISOString(),
    })
      .then((data) => ({ data }))
      .catch((error: unknown) => ({ error }));
    const { data, error } = inserted as { data?: { id: string; created_at: string } | null; error?: unknown };
    if (error || !data) {
      deps.notify("Не удалось отложить сообщение. Проверь подключение и права Supabase.");
      deps.setScheduleOpen(false);
      return;
    }
    const createdAt = new Date(data.created_at).getTime();
    const message: Message = {
      id: numericId(data.id),
      remoteId: data.id,
      author: deps.profileName,
      text,
      time: at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
      mine: true,
      createdAt,
      sendAt: at.getTime(),
      ...(sticker ? { stickerId: sticker.id } : {}),
    };
    deps.setChats((current) =>
      updateChat(current, deps.activeId, (chat) => ({
        ...chat,
        // The chat list keeps showing the last delivered message: a pending one is not what
        // the conversation last said.
        messages: placeNewMessage(chat.messages, message),
      }))
    );
    deps.setDraft("");
    deps.setDrafts((current) => ({ ...current, [deps.activeId]: "" }));
    deps.setReplyTarget(null);
    deps.setScheduleOpen(false);
    deps.notify(`Уйдёт ${formatSendAt(at, new Date())}`);
  }

  return {
    editingMessageId,
    setEditingMessageId,
    editDraft,
    setEditDraft,
    sendMessage,
    sendSticker,
    scheduleMessage,
    clearComposer,
  };
}
