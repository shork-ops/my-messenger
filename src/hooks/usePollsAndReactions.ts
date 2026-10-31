/**
 * Polls and reactions.
 *
 * Both are small features with one shared trap: the local list has to show the result the
 * server actually stored, not the one the person expected. A vote that appears counted but was
 * never written is worse than a vote that visibly failed.
 */

import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { Chat, Message, MessageEffect } from "../types";
import { supabase } from "../lib/supabase";
import { clockTime, numericId } from "../lib/format";
import { appendMessage, mapMessages, updateChat } from "../lib/chats";
import { placeNewMessage } from "../lib/messageOrder";
import { toggleLocalVote } from "../lib/polls";

export function usePollsAndReactions(deps: {
  accountId: string | null;
  profileName: string;
  activeId: number;
  chats: Chat[];
  setChats: Dispatch<SetStateAction<Chat[]>>;
  notify: (text: string) => void;
  setOpenMessageActionsId: Dispatch<SetStateAction<number | null>>;
  pollQuestion: string;
  pollOptions: string[];
  setPollOpen: Dispatch<SetStateAction<boolean>>;
  setPollOptions: Dispatch<SetStateAction<string[]>>;
  setPollQuestion: Dispatch<SetStateAction<string>>;
}) {
  async function createPoll(event: FormEvent) {
    event.preventDefault();
    const question = deps.pollQuestion.trim();
    const options = deps.pollOptions.map((text) => text.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      deps.notify("Для опроса нужны вопрос и минимум два варианта");
      return;
    }
    const targetChat = deps.chats.find((chat) => chat.id === deps.activeId);
    const client = supabase;
    // Option ids only need to be unique within this poll, so this timestamp is used
    // for naming them; where the poll sits is decided by the server below.
    let createdAt = Date.now();
    const poll: NonNullable<Message["poll"]> = {
      question,
      options: options.map((text, index) => ({ id: `${createdAt}-${index}`, text, votes: [] })),
    };
    let remoteId: string | undefined;
    if (targetChat?.remoteId) {
      if (!client || !deps.accountId) {
        deps.notify("Войди в аккаунт, чтобы опубликовать опрос");
        return;
      }
      const { data, error } = await client.from("messages").insert({ chat_id: targetChat.remoteId, sender_id: deps.accountId, body: question, poll }).select("id, created_at").single();
      if (error || !data) {
        deps.notify("Опрос не сохранён. Проверь, что выполнил SQL-миграцию persistent_polls в Supabase.");
        return;
      }
      remoteId = data.id;
      // Same reason as a plain message: the server's clock decides where it sits.
      createdAt = new Date(data.created_at).getTime();
    } else if (client && deps.accountId) {
      deps.notify("Этот чат локальный. Создай облачный чат, чтобы опрос синхронизировался.");
      return;
    }
    const time = clockTime(new Date(createdAt));
    const message: Message = {
      id: remoteId ? numericId(remoteId) : createdAt,
      ...(remoteId ? { remoteId } : {}),
      author: deps.profileName,
      text: question,
      time,
      mine: true,
      createdAt,
      poll,
    };
    deps.setChats((current) => appendMessage(current, deps.activeId, message, `📊 ${question}`, time));
    deps.setPollOpen(false);
    deps.setPollQuestion("");
    deps.setPollOptions(["", ""]);
    deps.notify("Опрос создан");
  }

  async function votePoll(messageId: number, optionId: string) {
    const chat = deps.chats.find((item) => item.id === deps.activeId);
    const message = chat?.messages.find((item) => item.id === messageId);
    if (!message?.poll) return;
    if (chat?.remoteId && message.remoteId) {
      if (!supabase || !deps.accountId) {
        deps.notify("Войди в аккаунт, чтобы голосовать");
        return;
      }
      const { data, error } = await supabase.rpc("vote_on_poll", { message_id_input: message.remoteId, option_id_input: optionId });
      if (error || !data) {
        deps.notify("Не удалось сохранить голос. Проверь SQL-миграцию persistent_polls.");
        return;
      }
      const poll = data as NonNullable<Message["poll"]>;
      deps.setChats((current) => mapMessages(current, deps.activeId, (entry) => (entry.id === messageId ? { ...entry, poll } : entry)));
      return;
    }
    deps.setChats((current) =>
      mapMessages(current, deps.activeId, (entry) =>
        entry.id !== messageId || !entry.poll ? entry : { ...entry, poll: toggleLocalVote(entry.poll, optionId, deps.profileName) }
      )
    );
  }

  async function toggleReaction(messageId: number, emoji: string) {
    const chat = deps.chats.find((item) => item.id === deps.activeId);
    const message = chat?.messages.find((item) => item.id === messageId);
    const client = supabase;
    if (!chat || !message || !chat.remoteId || !message.remoteId || !client || !deps.accountId) {
      deps.notify("Реакции доступны в облачных сообщениях");
      return;
    }
    const { data: existing, error: readError } = await client
      .from("message_reactions")
      .select("emoji")
      .eq("message_id", message.remoteId)
      .eq("user_id", deps.accountId)
      .eq("emoji", emoji)
      .maybeSingle();
    if (readError) {
      deps.notify("Не удалось проверить реакцию");
      return;
    }
    const result = existing
      ? await client.from("message_reactions").delete().eq("message_id", message.remoteId).eq("user_id", deps.accountId).eq("emoji", emoji)
      : await client.from("message_reactions").insert({ message_id: message.remoteId, user_id: deps.accountId, emoji });
    if (result.error) {
      deps.notify("Не удалось сохранить реакцию в облаке");
      return;
    }
    const { data: rows, error } = await client.from("message_reactions").select("emoji").eq("message_id", message.remoteId);
    if (error) {
      deps.notify("Реакция сохранена, но список не обновился");
      return;
    }
    const emojis = (rows ?? []).map((row) => row.emoji);
    deps.setChats((current) => mapMessages(current, deps.activeId, (entry) => (entry.id === messageId ? { ...entry, reactions: emojis } : entry)));
    deps.setOpenMessageActionsId(null);
  }

  // History is fetched once when the app loads, but messages keep arriving while
  // another chat is open, and the realtime channel only listens to the active
  // chat. Without this refresh the conversation can show "no messages yet"
  // although the database already holds them.

  return { createPoll, votePoll, toggleReaction };
}
