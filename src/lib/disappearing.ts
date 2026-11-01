import type { Chat, Message } from "../types";

/**
 * Disappearing messages: a chat timer after which every new message is removed for everyone.
 *
 * In a cloud chat the database is the authority. It stamps each message with its deadline
 * (`messages.expires_at`), stops returning it once the deadline passes and deletes it later
 * (supabase/migrations/20261052_disappearing_messages.sql). What runs on this device only
 * makes the screen agree with that: a bubble goes away at its deadline instead of at the
 * next reload. A chat that lives only on this device has no server, so the rule applies here.
 *
 * This module is on the first screen, which has a size budget (scripts/check-bundle-budget.mjs):
 * it holds only what drawing needs. The rules themselves load right after (disappearingLive.ts).
 */

/** The timers the server accepts; any other value is refused by `chats_message_ttl_check`. */
export const DISAPPEARING_OPTIONS = [
  { seconds: null, label: "Выключено" },
  { seconds: 3600, label: "1 час" },
  { seconds: 86_400, label: "1 день" },
  { seconds: 604_800, label: "1 неделя" },
  { seconds: 2_592_000, label: "1 месяц" },
] as const;

export type DisappearingSeconds = Exclude<(typeof DISAPPEARING_OPTIONS)[number]["seconds"], null>;

export function isDisappearingSeconds(value: unknown): value is DisappearingSeconds {
  return value !== null && DISAPPEARING_OPTIONS.some((option) => option.seconds === value);
}

export function ttlLabel(seconds: number | null | undefined): string {
  return DISAPPEARING_OPTIONS.find((option) => option.seconds === (seconds ?? null))?.label ?? "Выключено";
}

/**
 * What may be written to this device's storage. An expired message never is. In a cloud chat
 * no message with a deadline is either, nor its text as the chat preview: the server holds
 * it, and the stored copy of a cloud chat is never read back, so writing it would only leave
 * the text on disk after it has gone everywhere else.
 */
export function chatsForStorage(chats: Chat[], now: number): Chat[] {
  return chats.map((chat) => {
    const keep = (message: Message) => message.disappearsAt === undefined || (!chat.remoteId && message.disappearsAt > now);
    const messages = chat.messages.filter(keep);
    if (messages.length === chat.messages.length) return chat;
    const last = messages[messages.length - 1];
    const lastKept = last === chat.messages[chat.messages.length - 1];
    return lastKept ? { ...chat, messages } : { ...chat, messages, preview: last?.text ?? "Нет сообщений", time: last?.time ?? "" };
  });
}

/** "Исчезнет 02.11.2026, 14:30" for the bubble. */
export function deadlineTitle(at: number): string {
  return "Исчезнет " + new Date(at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}
