/**
 * What can be done to a message.
 *
 * Every action here follows the same shape: find the conversation, tell the server if there is
 * one, update the local list, and say what happened. The shape is worth having in one place
 * because the parts have to stay in step - an action that updates the local list but fails on
 * the server shows a message that will be gone after a reload, and one that writes to the
 * server but not locally shows nothing until it is.
 *
 * Two of these deliberately do not talk to the server at all: "у себя" is a viewing preference,
 * and undo reverses something that was only local to begin with.
 */

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Chat, Message, MessageEffect } from "../types";
import { supabase } from "../lib/supabase";
import { mapMessages, removeMessage, restoreMessage } from "../lib/chats";
import { formatForwardText, nextLocalId } from "../lib/messageActions";
import { clockTime } from "../lib/format";

export type DeletedMessage = { chatId: number; message: Message; index: number } | null;

export function useMessageActions(deps: {
  accountId: string | null;
  profileName: string;
  activeId: number;
  chats: Chat[];
  setChats: Dispatch<SetStateAction<Chat[]>>;
  notify: (text: string) => void;
  setOpenMessageActionsId: Dispatch<SetStateAction<number | null>>;
}) {
  const [deletedMessage, setDeletedMessage] = useState<DeletedMessage>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const findChat = () => deps.chats.find((item) => item.id === deps.activeId);

  /** Sends the message into the open chat with a marker naming the original author. */
  async function forwardMessage(message: Message) {
    deps.setOpenMessageActionsId(null);
    const text = formatForwardText(message);
    const chat = findChat();
    if (!chat) return;

    const appendCopy = (remoteId?: string) =>
      deps.setChats((current) =>
        current.map((item) =>
          item.id === chat.id
            ? {
                ...item,
                messages: [
                  ...item.messages,
                  {
                    id: nextLocalId(item.messages),
                    ...(remoteId ? { remoteId } : {}),
                    author: deps.profileName,
                    text,
                    time: clockTime(new Date()),
                    mine: true,
                    createdAt: Date.now(),
                  },
                ],
                preview: text.split("\n").pop() ?? text,
                time: clockTime(new Date()),
              }
            : item
        )
      );

    if (chat.remoteId) {
      const client = supabase;
      if (!client || !deps.accountId) {
        deps.notify("Нет подключения к Supabase");
        return;
      }
      const { data, error } = await client
        .from("messages")
        .insert({ chat_id: chat.remoteId, sender_id: deps.accountId, body: text })
        .select("id")
        .single();
      if (error) {
        deps.notify("Не удалось переслать сообщение");
        return;
      }
      appendCopy(data.id as string);
      deps.notify("Сообщение переслано");
      return;
    }

    // Local-only chat: the message never leaves this browser.
    appendCopy();
    deps.notify("Сообщение переслано");
  }

  async function deleteMessage(messageId: number) {
    const chat = findChat();
    const index = chat?.messages.findIndex((message) => message.id === messageId) ?? -1;
    const message = index >= 0 ? chat?.messages[index] : undefined;
    if (!chat || !message) return;
    if (chat.remoteId && message.remoteId && supabase) {
      const { error } = await supabase
        .from("messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", message.remoteId)
        .eq("sender_id", deps.accountId);
      if (error) {
        deps.notify("Не удалось удалить сообщение в облаке");
        return;
      }
    }
    setDeletedMessage({ chatId: deps.activeId, message, index });
    deps.setChats((current) => removeMessage(current, deps.activeId, messageId).chats);
    deps.setOpenMessageActionsId(null);
    if (editingMessageId === messageId) {
      setEditingMessageId(null);
      setEditDraft("");
    }
  }

  /**
   * Removes a message from this account's view only.
   *
   * Nothing is written to the other side: "у себя" is a viewing preference, not a statement
   * about the conversation.
   */
  async function deleteMessageLocal(messageId: number) {
    const chat = findChat();
    const index = chat?.messages.findIndex((message) => message.id === messageId) ?? -1;
    const message = index >= 0 ? chat?.messages[index] : undefined;
    if (!chat || !message) return;
    if (chat.remoteId && message.remoteId && supabase && deps.accountId) {
      // Recorded per account so the row does not come back on reload.
      await supabase
        .from("message_hides")
        .upsert({ message_id: message.remoteId, user_id: deps.accountId }, { onConflict: "message_id,user_id" });
    }
    setDeletedMessage({ chatId: deps.activeId, message, index });
    deps.setChats((current) => removeMessage(current, deps.activeId, messageId).chats);
    deps.setOpenMessageActionsId(null);
    deps.notify("Удалено у вас");
  }

  function undoDelete() {
    if (!deletedMessage) return;
    deps.setChats((current) => restoreMessage(current, deletedMessage));
    setDeletedMessage(null);
  }

  async function applyMessageEffect(messageId: number, effect: MessageEffect) {
    const chat = findChat();
    const message = chat?.messages.find((item) => item.id === messageId);
    // The menu hides the stickers on someone else's message, but hiding a control is not a
    // rule. In the cloud the update is already scoped to the sender; locally it was not, so
    // an effect could be painted onto a message its author never decorated.
    if (!message?.mine) return;
    if (chat?.remoteId && message.remoteId) {
      if (!supabase) return;
      const { error } = await supabase
        .from("messages")
        .update({ effect: message.effect === effect ? null : effect })
        .eq("id", message.remoteId)
        .eq("sender_id", deps.accountId);
      if (error) {
        deps.notify("Не удалось сохранить эффект в облаке");
        return;
      }
    }
    deps.setChats((current) =>
      mapMessages(current, deps.activeId, (entry) =>
        entry.id !== messageId ? entry : { ...entry, effect: entry.effect === effect ? undefined : effect }
      )
    );
    deps.setOpenMessageActionsId(null);
    deps.notify("Эффект сообщения обновлён");
  }

  function copyMessage(message: Message) {
    navigator.clipboard
      ?.writeText(message.text)
      .then(() => deps.notify("Текст скопирован"))
      .catch(() => deps.notify("Не удалось скопировать текст"));
    deps.setOpenMessageActionsId(null);
  }

  function startEditing(message: Message) {
    setEditingMessageId(message.id);
    setEditDraft(message.text);
  }

  return {
    deletedMessage,
    setDeletedMessage,
    editingMessageId,
    setEditingMessageId,
    editDraft,
    setEditDraft,
    forwardMessage,
    deleteMessage,
    deleteMessageLocal,
    undoDelete,
    applyMessageEffect,
    copyMessage,
    startEditing,
  };
}
