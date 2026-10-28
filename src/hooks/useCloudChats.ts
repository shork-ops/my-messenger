import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../lib/supabase";
import { clockTime, numericId } from "../lib/format";
import type { Chat, Message } from "../types";

type UseCloudChatsOptions = {
  accountId: string | null;
  profileReady: boolean;
  profileName: string;
  notify: (message: string) => void;
  setChats: Dispatch<SetStateAction<Chat[]>>;
  setActiveId: Dispatch<SetStateAction<number>>;
};

export function useCloudChats({ accountId, profileReady, profileName, notify, setChats, setActiveId }: UseCloudChatsOptions) {
  useEffect(() => {
    const client = supabase;
    if (!client || !accountId || !profileReady) return;
    let alive = true;
    const loadCloudChats = async () => {
      const { data: memberships, error: membershipError } = await client.from("chat_members").select("chat_id").eq("user_id", accountId);
      if (!alive) return;
      if (membershipError) {
        notify("Не удалось загрузить облачные чаты");
        return;
      }
      const chatIds = [...new Set((memberships ?? []).map((item) => item.chat_id as string))];
      if (chatIds.length === 0) {
        setChats([]);
        return;
      }
      const [{ data: cloudChatRows, error: chatsError }, { data: profileRows }] = await Promise.all([
        client.from("chats").select("id, title, is_group, invite_code, created_at").in("id", chatIds).order("updated_at", { ascending: false }),
        client.from("chat_members").select("chat_id, user_id").in("chat_id", chatIds),
      ]);
      if (!alive) return;
      if (chatsError) {
        notify("Не удалось загрузить список чатов");
        return;
      }
      const memberIds = [...new Set((profileRows ?? []).map((row) => row.user_id as string).filter((id) => id !== accountId))];
      const { data: memberProfiles } = memberIds.length
        ? await client.from("profiles").select("id, username, display_name, avatar").in("id", memberIds)
        : { data: [] as { id: string; username: string | null; display_name: string; avatar: string }[] };
      const { data: messageRows, error: messagesError } = await client
        .from("messages")
        .select("id, chat_id, sender_id, body, attachment, effect, poll, reply_to, created_at, edited_at, deleted_at")
        .in("chat_id", chatIds)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (!alive) return;
      if (messagesError) notify("Чаты загружены, но сообщения получить не удалось");

      const mappedChats: Chat[] = await Promise.all(
        (cloudChatRows ?? []).map(async (row) => {
          const chatMembers = (profileRows ?? []).filter((member) => member.chat_id === row.id);
          const otherId = chatMembers.find((member) => member.user_id !== accountId)?.user_id;
          const other = (memberProfiles ?? []).find((profile) => profile.id === otherId);
          const chatMessages: Message[] = await Promise.all(
            (messageRows ?? [])
              .filter((message) => message.chat_id === row.id)
              .map(async (message) => {
                const sender = message.sender_id === accountId ? profileName : other?.display_name || "Пользователь";
                const created = new Date(message.created_at);
                const { data: reactionRows } = await client.from("message_reactions").select("emoji").eq("message_id", message.id);
                const attachmentMeta = message.attachment as { name?: string; type?: string; size?: number; path?: string } | null;
                let attachment: Message["attachment"];
                if (attachmentMeta) {
                  let data = "";
                  if (attachmentMeta.path) {
                    const { data: signed } = await client.storage.from("chat-media").createSignedUrl(attachmentMeta.path, 3600);
                    data = signed?.signedUrl || "";
                  }
                  attachment = {
                    name: attachmentMeta.name || "Вложение",
                    type: attachmentMeta.type || "application/octet-stream",
                    size: attachmentMeta.size || 0,
                    data,
                    ...(attachmentMeta.path ? { path: attachmentMeta.path } : {}),
                  };
                }
                return {
                  id: numericId(message.id),
                  remoteId: message.id,
                  author: sender,
                  text: message.deleted_at ? "Сообщение удалено" : message.body,
                  time: clockTime(created),
                  mine: message.sender_id === accountId,
                  createdAt: created.getTime(),
                  edited: Boolean(message.edited_at),
                  ...(message.effect ? { effect: message.effect } : {}),
                  ...(message.poll ? { poll: message.poll as Message["poll"] } : {}),
                  ...(attachment ? { attachment } : {}),
                  reactions: (reactionRows ?? []).map((reaction) => reaction.emoji),
                };
              })
          );
          const last = chatMessages[chatMessages.length - 1];
          return {
            id: numericId(row.id),
            remoteId: row.id,
            name: row.is_group ? row.title : other?.display_name || row.title,
            avatar: row.is_group ? "👥" : other?.avatar || other?.display_name?.slice(0, 1) || "N",
            color: row.is_group ? "group" : "blue",
            preview: last?.text || "Начни общение",
            time: last?.time || "",
            messages: chatMessages,
            group: row.is_group,
            inviteCode: row.invite_code || undefined,
            members: chatMembers.map(
              (member) =>
                member.user_id === accountId
                  ? profileName
                  : (memberProfiles ?? []).find((profile) => profile.id === member.user_id)?.display_name || "Пользователь"
            ),
          };
        })
      );
      setChats(mappedChats);
      setActiveId(mappedChats[0]?.id ?? 0);
    };
    void loadCloudChats();
    return () => {
      alive = false;
    };
  }, [accountId, profileReady, profileName, notify, setChats, setActiveId]);

  useEffect(() => {
    const client = supabase;
    const code = new URLSearchParams(window.location.search).get("join");
    if (!client || !accountId || !code) return;
    let cancelled = false;
    const join = async () => {
      const { error } = await client.rpc("join_group_by_invite", { invite_code_input: code });
      if (cancelled) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState({}, "", url.toString());
      if (error) {
        notify(error.message.includes("join_group_by_invite") ? "Примени миграцию облачных групп в Supabase" : "Ссылка недействительна или не удалось вступить в группу");
        return;
      }
      notify("Ты вступил в группу");
      window.location.reload();
    };
    void join();
    return () => {
      cancelled = true;
    };
  }, [accountId, notify]);
}
