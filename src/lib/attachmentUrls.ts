import type { Attachment, Chat } from "../types";
import { SIGNED_URL_REFRESH_MARGIN_MS } from "./messageSync";

/**
 * Tracks which attachment URLs are about to expire.
 *
 * The logic is pure so the scheduling decisions can be tested without a DOM:
 * the React hook only supplies the clock and the refresh callback.
 */

export type ExpiringAttachment = {
  chatId: number;
  messageId: number;
  path: string;
  expiresAt: number;
};

/** Collects attachments whose signed URL lapses soon, oldest expiry first. */
export function collectExpiringAttachments(chats: Chat[], now: number, marginMs = SIGNED_URL_REFRESH_MARGIN_MS): ExpiringAttachment[] {
  const due: ExpiringAttachment[] = [];
  for (const chat of chats) {
    for (const message of chat.messages) {
      const attachment = message.attachment;
      if (!attachment?.path || !attachment.expiresAt) continue;
      if (attachment.expiresAt - now > marginMs) continue;
      due.push({ chatId: chat.id, messageId: message.id, path: attachment.path, expiresAt: attachment.expiresAt });
    }
  }
  return due.sort((left, right) => left.expiresAt - right.expiresAt);
}

/**
 * How long to sleep before checking again.
 *
 * Returns null when nothing expires, so the caller can stop the timer instead
 * of waking up forever. The floor of one second avoids a busy loop when a URL
 * is already past its margin.
 */
export function nextRefreshDelay(chats: Chat[], now: number, marginMs = SIGNED_URL_REFRESH_MARGIN_MS): number | null {
  let soonest = Number.POSITIVE_INFINITY;
  for (const chat of chats) {
    for (const message of chat.messages) {
      const expiresAt = message.attachment?.expiresAt;
      if (!expiresAt) continue;
      const dueAt = expiresAt - marginMs;
      if (dueAt < soonest) soonest = dueAt;
    }
  }
  if (!Number.isFinite(soonest)) return null;
  return Math.max(1000, soonest - now);
}

/**
 * Applies a freshly signed URL to one message.
 *
 * Returns the original chat reference when nothing changes, so React can skip
 * re-rendering untouched conversations.
 */
export function withRefreshedUrl(
  chats: Chat[],
  target: { chatId: number; messageId: number },
  url: string,
  expiresAt: number
): Chat[] {
  let changed = false;
  const next = chats.map((chat) => {
    if (chat.id !== target.chatId) return chat;
    let chatChanged = false;
    const messages = chat.messages.map((message) => {
      if (message.id !== target.messageId || !message.attachment) return message;
      chatChanged = true;
      return { ...message, attachment: { ...message.attachment, data: url, expiresAt } };
    });
    if (!chatChanged) return chat;
    changed = true;
    return { ...chat, messages };
  });
  return changed ? next : chats;
}

/** True when a refresh is worth attempting: the path is known and the URL is stale or empty. */
export function needsRefresh(attachment: Attachment | undefined, now: number, marginMs = SIGNED_URL_REFRESH_MARGIN_MS): boolean {
  if (!attachment?.path) return false;
  if (!attachment.data) return true;
  if (!attachment.expiresAt) return false;
  return attachment.expiresAt - now <= marginMs;
}
