import type { Dispatch, SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDisappearingSeconds, ttlLabel, type DisappearingSeconds } from "./disappearing";
import type { Chat, Message } from "../types";

/**
 * The rules of disappearing messages on this device (see disappearing.ts for the whole
 * picture). Loaded right after the first screen rather than with it: nothing here is needed
 * to draw it, and the first screen has a size budget (scripts/check-bundle-budget.mjs).
 */

type SetChats = Dispatch<SetStateAction<Chat[]>>;


/**
 * Changes a chat's timer: on the server for a cloud chat, then on screen. Says what happened
 * either way - a refusal in words the person can act on, or the new timer.
 */
export async function changeChatTimer(
  client: SupabaseClient | null,
  chat: Chat,
  seconds: DisappearingSeconds | null,
  setChats: SetChats,
  notify: (message: string) => void
): Promise<void> {
  if (chat.remoteId) {
    const { error } = client
      ? await client.rpc("set_chat_message_ttl", { target_chat: chat.remoteId, ttl_seconds: seconds })
      : { error: { message: "network" } };
    if (error) return notify(timerErrorMessage(error));
  }
  setChats((current) => setChatTimer(current, (item) => item.id === chat.id, seconds, Date.now()));
  notify(timerNotice(seconds));
}

/** A refusal from `set_chat_message_ttl`, in words the person can act on. */
export function timerErrorMessage(error: { code?: string; message?: string } | null): string {
  const code = error?.code ?? "";
  const text = error?.message ?? "";
  if (code === "PGRST202" || code === "42883" || /set_chat_message_ttl/.test(text)) {
    return "На сервере ещё нет исчезающих сообщений — нужна миграция 20261052 в Supabase";
  }
  if (/admins/i.test(text)) return "Таймер в этом чате меняют только админы";
  if (code === "42501") return "Нет прав менять таймер в этом чате";
  if (/fetch|network/i.test(text)) return "Нет соединения — таймер не изменён";
  return "Не удалось изменить таймер. Попробуй ещё раз";
}

/** What the person sees once the timer is changed. */
export function timerNotice(seconds: DisappearingSeconds | null): string {
  return seconds ? `Исчезающие сообщения: ${ttlLabel(seconds)}` : "Исчезающие сообщения выключены";
}

/**
 * Who may change the timer. In a direct chat either person may, as in other messengers; in
 * a group or a channel it is a rule of the place, so only its owner and admins may. The
 * server applies the same rule; this only avoids offering buttons that would be refused.
 */
export function canChangeTimer(chat: Pick<Chat, "remoteId" | "group" | "channel" | "channelRole">, role: string | null): boolean {
  if (chat.channel) return chat.remoteId ? role === "owner" || role === "admin" : chat.channelRole === "owner";
  if (!chat.remoteId || !chat.group) return true;
  return role === "owner" || role === "admin";
}

/**
 * Brings the loaded messages in line with the timers, in one pass:
 *
 * - a message written after its chat's timer was switched on (`messageTtlSince`) gets its
 *   deadline. In a cloud chat the server gives every message one and sends it along; only
 *   this device's own accepted messages, shown before their row is read back, need it here.
 *   A message still sending or that failed has not reached the server yet;
 * - a message whose deadline has passed is removed, and the chat preview follows;
 * - `next` is the earliest deadline still ahead, for the timer that will look again.
 *
 * The same array comes back when nothing changed, so it is safe to call on every update.
 */
export function sweepDeadlines(chats: Chat[], now: number): { chats: Chat[]; next: number | null } {
  let next: number | null = null;
  let changed = false;
  const swept = chats.map((chat) => {
    const ttl = chat.messageTtlSeconds;
    const since = chat.messageTtlSince ?? Infinity;
    let touched = false;
    let lastRemoved = false;
    const messages: Message[] = [];
    chat.messages.forEach((message, index) => {
      if (
        ttl &&
        message.disappearsAt === undefined &&
        (message.createdAt ?? -1) >= since &&
        message.delivery !== "sending" &&
        message.delivery !== "failed" &&
        (!chat.remoteId || (message.mine && message.remoteId))
      ) {
        // A scheduled message starts its countdown when it is delivered, as on the server.
        message = { ...message, disappearsAt: Math.max(message.sendAt ?? 0, message.createdAt!) + ttl * 1000 };
        touched = true;
      }
      const at = message.disappearsAt;
      if (at !== undefined && at <= now) {
        touched = true;
        lastRemoved = index === chat.messages.length - 1;
        return;
      }
      if (at !== undefined && (next === null || at < next)) next = at;
      messages.push(message);
    });
    if (!touched) return chat;
    changed = true;
    const last = messages[messages.length - 1];
    return lastRemoved ? { ...chat, messages, preview: last?.text ?? "Нет сообщений", time: last?.time ?? "" } : { ...chat, messages };
  });
  return { chats: changed ? swept : chats, next };
}

/** Sets the timer of the chats `match` picks. It applies from now on: written messages keep theirs. */
export function setChatTimer(chats: Chat[], match: (chat: Chat) => boolean, seconds: number | null, now: number): Chat[] {
  let changed = false;
  const next = chats.map((chat) => {
    if (!match(chat) || (chat.messageTtlSeconds ?? null) === seconds) return chat;
    changed = true;
    return { ...chat, messageTtlSeconds: seconds, messageTtlSince: now };
  });
  return changed ? next : chats;
}

/** Timers of the given cloud chats. Before migration 20261052 the column is missing and no chat has one. */
export async function fetchChatTimers(client: SupabaseClient, chatIds: string[]): Promise<Map<string, DisappearingSeconds>> {
  const timers = new Map<string, DisappearingSeconds>();
  const { data, error } = chatIds.length
    ? await client.from("chats").select("id, message_ttl_seconds").in("id", chatIds)
    : { data: null, error: null };
  if (!error) {
    for (const row of (data ?? []) as { id: string; message_ttl_seconds?: unknown }[]) {
      if (isDisappearingSeconds(row.message_ttl_seconds)) timers.set(row.id, row.message_ttl_seconds);
    }
  }
  return timers;
}

/**
 * Follows the open chat's timer, so one switched by the other person shows up here at once.
 * A channel of its own: if the server does not publish chat changes yet, message delivery
 * must not suffer for it. Returns the unsubscribe.
 */
export function watchChatTimer(client: SupabaseClient, chatId: string, setChats: SetChats): () => void {
  const channel = client
    .channel(`nexus-chat-timer-${chatId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chats", filter: `id=eq.${chatId}` }, (payload) => {
      const row = payload.new as { message_ttl_seconds?: unknown };
      if (!row || !("message_ttl_seconds" in row)) return;
      const seconds = isDisappearingSeconds(row.message_ttl_seconds) ? row.message_ttl_seconds : null;
      setChats((current) => setChatTimer(current, (chat) => chat.remoteId === chatId, seconds, Date.now()));
    })
    .subscribe();
  return () => void client.removeChannel(channel);
}
