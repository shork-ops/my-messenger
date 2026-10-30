/**
 * The boundary between what has been read and what has not.
 *
 * A chat opened with three unread messages should land on the first of them, not at the
 * bottom - otherwise the unread state is decoration rather than a place.
 *
 * `lastReadAt` is a **moment in time**, not a message number. An earlier version read it as
 * a message id here while `countUnread` and the cloud (both filling it from `member_read_at`
 * through `Date.parse`) read it as a moment. Message ids are small numbers and timestamps
 * are huge, so the divider essentially never appeared - and because both are `number`, the
 * type checker had nothing to say. Only a conversation long enough to scroll showed it.
 */

type Timed = { createdAt?: number; mine?: boolean };

/** True when the message was written after the read moment. */
function writtenAfter(message: Timed, readAt: number): boolean {
  return typeof message.createdAt === "number" && message.createdAt > readAt;
}

/** Where the divider goes, given the moment the chat was last read. */
export function firstUnreadIndex(messages: Timed[], lastReadAt: number | null): number | null {
  if (messages.length === 0) return null;
  if (lastReadAt === null) return null;

  // A message with no timestamp cannot be placed relative to a moment; putting the divider
  // somewhere approximate is worse than not showing it.
  const found = messages.findIndex((message) => writtenAfter(message, lastReadAt));
  if (found < 0) return null;

  // Your own messages do not start a run of unread ones; skip past them so the divider
  // lands on something the other person wrote.
  let index = found;
  while (index < messages.length && messages[index].mine) index += 1;
  return index < messages.length ? index : null;
}

/** How many are unread, for the "3 new messages" pill. */
export function unreadCount(messages: Timed[], lastReadAt: number | null): number {
  if (lastReadAt === null) return 0;
  return messages.filter((message) => writtenAfter(message, lastReadAt)).length;
}

/**
 * Where to scroll when a chat is opened.
 *
 * "bottom" for a chat with nothing new, the divider for one with unread messages.
 */
export type ScrollTarget = { kind: "bottom" } | { kind: "index"; index: number };

export function initialScrollTarget(messages: Timed[], lastReadAt: number | null): ScrollTarget {
  const index = firstUnreadIndex(messages, lastReadAt);
  return index === null ? { kind: "bottom" } : { kind: "index", index };
}

/** Whether the chat has unread messages the divider will point at. */
export function unreadMessages(chat: { messages: Timed[]; lastReadAt?: number }): boolean {
  const readAt = chat.lastReadAt ?? null;
  if (readAt === null) return false;
  return chat.messages.some((message) => writtenAfter(message, readAt) && !message.mine);
}

/** Label for the jump-to-unread button. */
export function unreadLabel(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "1 непрочитанное";
  // Russian needs three plural forms, and 11-14 are the exception that catches every
  // implementation that only looks at the last digit.
  const tail = count % 100;
  const last = count % 10;
  if (tail >= 11 && tail <= 14) return `${count} непрочитанных`;
  if (last >= 2 && last <= 4) return `${count} непрочитанных`;
  return `${count} непрочитанных`;
}
