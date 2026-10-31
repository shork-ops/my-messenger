/**
 * Starting a conversation.
 *
 * Two ways in: from a name, which creates a group, and from a person found by search, which
 * opens the direct chat or makes one. Both have to cope with the chat already existing - a
 * second "Аня" in the list is a small bug that becomes impossible to clean up later.
 */

import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { Chat, UserSearchResult } from "../types";
import { supabase } from "../lib/supabase";
import { clockTime, numericId } from "../lib/format";
import { isDemoMode } from "../lib/constants";
import { directChatFromSearch, findDirectChatByPeer, updateChat } from "../lib/chats";

export function useChatCreation(deps: {
  accountId: string | null;
  profileName: string;
  setChats: Dispatch<SetStateAction<Chat[]>>;
  setActiveId: Dispatch<SetStateAction<number>>;
  setActiveNav: Dispatch<SetStateAction<string>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setNewChatName: Dispatch<SetStateAction<string>>;
  setNewChatOpen: Dispatch<SetStateAction<boolean>>;
  setMobileView: Dispatch<SetStateAction<"list" | "chat">>;
  setOpenedChatId: Dispatch<SetStateAction<number | null>>;
  setOpeningUserId: Dispatch<SetStateAction<string | null>>;
  setSearch: Dispatch<SetStateAction<string>>;
  chats: Chat[];
  newChatName: string;
  newChatIsGroup: boolean;
  selectChat: (chat: Chat) => Promise<void>;
  notify: (text: string) => void;
}) {
  async function createChat(event: FormEvent) {
    event.preventDefault();
    const name = deps.newChatName.trim();
    if (!name) return;
    const wantsGroup = isDemoMode ? deps.newChatIsGroup : true;
    if (wantsGroup) {
      if (!supabase || !deps.accountId) {
        deps.notify("Войди в аккаунт, чтобы создать облачную группу");
        return;
      }
      const { data, error } = await supabase.rpc("create_group_chat", { group_title: name });
      const createdRow = Array.isArray(data) ? data[0] : data;
      if (error || !createdRow?.chat_id) {
        deps.notify(error?.message?.includes("create_group_chat") ? "Примени миграцию 20261028_cloud_group_chats.sql в Supabase" : "Не удалось создать облачную группу");
        return;
      }
      const created: Chat = {
        id: numericId(createdRow.chat_id),
        remoteId: createdRow.chat_id,
        name,
        avatar: "👥",
        color: "group",
        preview: "Группа создана",
        time: clockTime(),
        messages: [],
        group: true,
        members: [deps.profileName],
        inviteCode: createdRow.invite_code,
      };
      deps.setChats((current) => [created, ...current]);
      deps.setActiveId(created.id);
      deps.setDraft("");
      deps.setNewChatName("");
      deps.setNewChatOpen(false);
      deps.setActiveNav("Чаты");
      deps.notify("Облачная группа создана");
      return;
    }
    const existing = deps.chats.find((chat) => chat.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"));
    if (existing) {
      deps.setActiveId(existing.id);
      deps.setNewChatOpen(false);
      deps.setNewChatName("");
      deps.notify("Этот чат уже существует");
      return;
    }
    const id = Date.now();
    const created: Chat = { id, name, avatar: name.slice(0, 1).toUpperCase(), color: "blue", preview: "Новый чат", time: clockTime(), messages: [] };
    deps.setChats((current) => [created, ...current]);
    deps.setActiveId(id);
    deps.setDraft("");
    deps.setNewChatName("");
    deps.setNewChatOpen(false);
    deps.setActiveNav("Чаты");
    deps.notify(`Чат «${name}» создан локально`);
  }

  async function openDirectChat(user: UserSearchResult) {
    const client = supabase;
    if (!client || !deps.accountId) {
      deps.notify("Войди в аккаунт, чтобы начать переписку");
      return;
    }
    const existing = findDirectChatByPeer(deps.chats, user.id);
    if (existing) {
      deps.selectChat(existing);
      deps.setSearch("");
      deps.setActiveNav("Чаты");
      return;
    }
    deps.setOpeningUserId(user.id);
    const { data, error } = await client.rpc("create_direct_chat", { target_user_id: user.id });
    deps.setOpeningUserId(null);
    if (error || !data) {
      deps.notify(error?.message.includes("function") ? "Выполни SQL-миграцию direct_chats в Supabase" : "Не удалось создать диалог. Проверь SQL-миграцию и попробуй ещё раз.");
      return;
    }
    const remoteId = data as string;
    const known = deps.chats.find((chat) => chat.remoteId === remoteId);
    if (known) {
      deps.setChats((current) => updateChat(current, known.id, (chat) => ({ ...chat, peerId: user.id, avatarPath: user.avatar_path ?? null })));
      deps.selectChat(known);
      deps.setSearch("");
      return;
    }
    const created = directChatFromSearch(remoteId, user, deps.profileName);
    const localId = created.id;
    deps.setChats((current) => (current.some((chat) => chat.remoteId === remoteId) ? current : [created, ...current]));
    deps.setActiveId(localId);
    deps.setMobileView("chat");
    deps.setOpenedChatId(localId);
    deps.setSearch("");
    deps.setDraft("");
    deps.setActiveNav("Чаты");
    deps.notify(`Диалог с @${user.username} создан`);
  }

  /**
   * Uploads one picture and returns what the message will carry for it.
   *
   * Shared by single pictures and albums so a photo looks and costs the same either way; the
   * compression and the size rules are not worth having in two places.
   */

  return { createChat, openDirectChat };
}
