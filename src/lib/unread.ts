/**
 * The boundary between what has been read and what has not.
 *
 * A chat opened with three unread messages should land on the first of them, not
 * at the bottom - otherwise the unread state is decoration rather than a place.
 */

/** Where the divider goes, given the last message id that was already read. */
export function firstUnreadIndex(
  messages: { id: number; mine?: boolean }[],
  lastReadId: number | null
): number | null {
  if (messages.length === 0) return null;
  if (lastReadId === null) return null;

  const found = messages.findIndex((message) => message.id > lastReadId);
  if (found < 0) return null;

  // Your own messages do not start a run of unread ones; skip past them so the
  // divider lands on something the other person wrote.
  let index = found;
  while (index < messages.length && messages[index].mine) index += 1;
  return index < messages.length ? index : null;
}

/** How many are unread, for the "3 new messages" pill. */
export function unreadCount(messages: { id: number }[], lastReadId: number | null): number {
  if (lastReadId === null) return 0;
  return messages.filter((message) => message.id > lastReadId).length;
}

/**
 * Where to scroll when a chat is opened.
 *
 * "bottom" for a chat with nothing new, the divider for one with unread messages.
 */
export type ScrollTarget = { kind: "bottom" } | { kind: "index"; index: number };

export function initialScrollTarget(messages: { id: number; mine?: boolean }[], lastReadId: number | null): ScrollTarget {
  const index = firstUnreadIndex(messages, lastReadId);
  return index === null ? { kind: "bottom" } : { kind: "index", index };
}

/** Label for the jump-to-unread button. */
export function unreadLabel(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "1 непрочитанное";
  if (count < 5) return `${count} непрочитанных`;
  return `${count} непрочитанных`;
}

/** Whether the chat has unread messages the divider will point at. */
export function unreadMessages(chat: { messages: { id: number; mine?: boolean }[]; lastReadAt?: number }): boolean {
  const lastReadId = chat.lastReadAt ?? null;
  if (lastReadId === null) return false;
  return chat.messages.some((message) => message.id > lastReadId && !message.mine);
}
