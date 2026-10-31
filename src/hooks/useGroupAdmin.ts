/**
 * Running a group.
 *
 * Invitations and membership are the part of a group where a mistake is visible to other
 * people: a link that was meant to be replaced still works, or someone is removed from a
 * conversation they are still in. Each action here therefore either completes on the server and
 * then updates the local list, or reports why it did not.
 */

import type { Dispatch, SetStateAction } from "react";
import type { Chat } from "../types";
import { supabase } from "../lib/supabase";
import { removeMember, rotateInvite } from "../lib/groupAdmin";
import { setMemberRole } from "../lib/groupAdmin";

export function useGroupAdmin(deps: {
  accountId: string | null;
  activeChat: Chat;
  activeId: number;
  setChats: Dispatch<SetStateAction<Chat[]>>;
  notify: (text: string) => void;
  setMembersRefreshKey: Dispatch<SetStateAction<number>>;
}) {
  async function createInviteLink() {
    if (!deps.activeChat.group) {
      deps.notify("Приглашения доступны для групповых чатов");
      return;
    }
    if (!deps.activeChat.remoteId || !deps.activeChat.inviteCode) {
      deps.notify("Для этой группы нет облачной ссылки. Создай облачную группу заново.");
      return;
    }
    const link = `${window.location.origin}${window.location.pathname}?join=${deps.activeChat.inviteCode}`;
    try {
      await navigator.clipboard.writeText(link);
      deps.notify("Ссылка-приглашение скопирована");
    } catch {
      deps.notify(`Ссылка: ${link}`);
    }
  }

  /** Issues a new invite code, which immediately invalidates the previous link. */

  async function rotateInviteLink() {
    const client = supabase;
    if (!client || !deps.activeChat.remoteId) {
      deps.notify("Обновление ссылки доступно только для облачных групп");
      return;
    }
    const result = await rotateInvite(client, deps.activeChat.remoteId);
    if (!result.ok) {
      deps.notify(result.message);
      return;
    }
    deps.setChats((current) =>
      current.map((chat) => (chat.id === deps.activeId ? { ...chat, inviteCode: result.data } : chat))
    );
    const link = `${window.location.origin}${window.location.pathname}?join=${result.data}`;
    try {
      await navigator.clipboard.writeText(link);
      deps.notify("Новая ссылка-приглашение создана и скопирована");
    } catch {
      deps.notify(`Новая ссылка: ${link}`);
    }
  }

  async function changeMemberRole(userId: string, role: "admin" | "member") {
    const client = supabase;
    if (!client || !deps.activeChat.remoteId) return;
    const result = await setMemberRole(client, deps.activeChat.remoteId, userId, role);
    if (!result.ok) {
      deps.notify(result.message);
      return;
    }
    deps.notify(role === "admin" ? "Участник назначен администратором" : "Администратор снят");
    deps.setMembersRefreshKey((key) => key + 1);
  }

  async function kickMember(userId: string) {
    const client = supabase;
    if (!client || !deps.activeChat.remoteId) return;
    const result = await removeMember(client, deps.activeChat.remoteId, userId);
    if (!result.ok) {
      deps.notify(result.message);
      return;
    }
    deps.notify("Участник удалён из группы");
    deps.setMembersRefreshKey((key) => key + 1);
  }

  async function leaveGroup() {
    const client = supabase;
    if (!client || !deps.activeChat.remoteId || !deps.accountId) return;
    const result = await removeMember(client, deps.activeChat.remoteId, deps.accountId);
    if (!result.ok) {
      deps.notify(result.message);
      return;
    }
    deps.notify("Ты покинул группу");
    deps.setChats((current) => current.filter((chat) => chat.id !== deps.activeId));
  }

  return { createInviteLink, rotateInviteLink, changeMemberRole, kickMember, leaveGroup };
}
