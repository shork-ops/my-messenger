import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { supabase } from "../lib/supabase";
import { numericId } from "../lib/format";
import { countUnread } from "../lib/readState";
import { fetchReactions } from "../lib/messageSync";
import { DEFAULT_MESSAGE_PAGE_SIZE, loadMessagePage } from "../lib/messageLoader";
import type { Chat, Message } from "../types";

type UseCloudChatsOptions = {
  accountId: string | null;
  profileReady: boolean;
  profileName: string;
  notify: (message: string) => void;
  setChats: Dispatch<SetStateAction<Chat[]>>;
  setActiveId: Dispatch<SetStateAction<number>>;
  /** Filled with a function that reloads the chat list from the database. */
  reloadRef?: MutableRefObject<(() => void) | null>;
};

/**
 * Loads cloud chats with the newest page of history for each one.
 * Older pages are fetched lazily by `useHistoryPagination`.
 */
export function useCloudChats({
  accountId,
  profileReady,
  profileName,
  notify,
  setChats,
  setActiveId,
  reloadRef,
}: UseCloudChatsOptions) {
  const reloadRefInternal = useRef<(() => void) | null>(null);
  const target = reloadRef ?? reloadRefInternal;
  useEffect(() => {
    const client = supabase;
    if (!client || !accountId || !profileReady) return;
    let alive = true;

    const loadCloudChats = async () => {
      // Read this account's own membership rows in full: muting and archiving are
      // stored there, beside the read mark.
      const { data: memberships, error: membershipError } = await client
        .from("chat_members")
        .select("chat_id, muted_until, archived_at")
        .eq("user_id", accountId);
      if (!alive) return;
      if (membershipError) {
        notify("Не удалось загрузить облачные чаты");
        return;
      }
      const chatIds = [...new Set((memberships ?? []).map((item) => item.chat_id as string))];
      // Keyed by chat so the mapping below can look up this account's settings.
      const myMembership = new Map(
        (memberships ?? []).map((item) => [item.chat_id as string, item as { muted_until?: string | null; archived_at?: string | null }])
      );
      if (chatIds.length === 0) {
        setChats([]);
        return;
      }
      const [{ data: cloudChatRows, error: chatsError }, { data: profileRows }] = await Promise.all([
        client.from("chats").select("id, title, is_group, invite_code, created_at").in("id", chatIds).order("updated_at", { ascending: false }),
        client.from("chat_members").select("chat_id, user_id, last_read_at").in("chat_id", chatIds),
      ]);
      if (!alive) return;
      if (chatsError) {
        notify("Не удалось загрузить список чатов");
        return;
      }
      const memberIds = [...new Set((profileRows ?? []).map((row) => row.user_id as string).filter((id) => id !== accountId))];
      const { data: memberProfiles } = memberIds.length
        ? await client.from("profiles").select("id, username, display_name, avatar, avatar_path, last_seen_at").in("id", memberIds)
        : { data: [] as { id: string; username: string | null; display_name: string; avatar: string; avatar_path?: string | null; last_seen_at: string | null }[] };

      // One first page per chat, loaded in parallel instead of the old single limit(1000) request.
      const pages = await Promise.all(
        (cloudChatRows ?? []).map(async (row) => {
          const chatMembers = (profileRows ?? []).filter((member) => member.chat_id === row.id);
          const otherId = chatMembers.find((member) => member.user_id !== accountId)?.user_id;
          const other = (memberProfiles ?? []).find((profile) => profile.id === otherId);
          const page =
            (await loadMessagePage({
              chatId: row.id,
              accountId,
              selfName: profileName,
              authorName: other?.display_name || "Пользователь",
              pageSize: DEFAULT_MESSAGE_PAGE_SIZE,
            })) ?? [];
          const reactions = await fetchReactions(page.map((message) => message.remoteId!).filter(Boolean));
          const chatMessages: Message[] = page.map((message) => ({
            ...message,
            reactions: message.remoteId ? (reactions[message.remoteId] ?? []) : [],
          }));
          return { row, chatMembers, other, chatMessages };
        })
      );
      if (!alive) return;

      const mappedChats: Chat[] = pages.map(({ row, chatMembers, other, chatMessages }) => {
        const last = chatMessages[chatMessages.length - 1];
        const memberReadAt: Record<string, number> = {};
        for (const member of chatMembers) {
          memberReadAt[member.user_id as string] = member.last_read_at ? Date.parse(member.last_read_at as string) : 0;
        }
        const lastReadAt = memberReadAt[accountId] ?? 0;
        const memberLastSeenAt: Record<string, number> = {};
        for (const member of chatMembers) {
          const profile = (memberProfiles ?? []).find((entry) => entry.id === member.user_id);
          memberLastSeenAt[member.user_id as string] = profile?.last_seen_at ? Date.parse(profile.last_seen_at) : 0;
        }
        return {
          id: numericId(row.id),
          remoteId: row.id,
          peerId: row.is_group ? undefined : other?.id,
          name: row.is_group ? row.title : other?.display_name || row.title,
          avatar: row.is_group ? "👥" : other?.avatar || other?.display_name?.slice(0, 1) || "N",
          avatarPath: row.is_group ? null : other?.avatar_path ?? null,
          color: row.is_group ? "group" : "blue",
          preview: last?.text || "Начни общение",
          time: last?.time || "",
          messages: chatMessages,
          group: row.is_group,
          inviteCode: row.invite_code || undefined,
          lastReadAt,
          memberReadAt,
          memberLastSeenAt,
          historyExhausted: chatMessages.length < DEFAULT_MESSAGE_PAGE_SIZE,
          unread: countUnread(chatMessages, lastReadAt),
          mutedUntil: myMembership.get(row.id as string)?.muted_until
            ? Date.parse(myMembership.get(row.id as string)!.muted_until as string)
            : null,
          archived: Boolean(myMembership.get(row.id as string)?.archived_at),
          members: chatMembers.map(
            (member) =>
              member.user_id === accountId
                ? profileName
                : (memberProfiles ?? []).find((profile) => profile.id === member.user_id)?.display_name || "Пользователь"
          ),
        };
      });
      setChats(mappedChats);
      setActiveId(mappedChats[0]?.id ?? 0);
    };

    void loadCloudChats();
    // A realtime event can arrive before the first fetch finishes. Reloading the
    // list recovers that event instead of letting the message vanish.
    target.current = () => {
      if (alive) void loadCloudChats();
    };
    return () => {
      alive = false;
      target.current = null;
    };
  }, [accountId, profileReady, profileName, notify, setChats, setActiveId, reloadRef]);

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
