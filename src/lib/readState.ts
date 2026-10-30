import type { Message } from "../types";

export function countUnread(messages: Message[], lastReadAt: number | null): number {
  const threshold = lastReadAt ?? 0;
  return messages.filter((message) => !message.mine && Boolean(message.createdAt) && message.createdAt! > threshold).length;
}

export function isReadByEveryone(message: Message, memberReadAt: Record<string, number>, selfId: string | null): boolean {
  if (!message.mine || !message.createdAt) return false;
  const others = Object.entries(memberReadAt).filter(([userId]) => userId !== selfId);
  if (others.length === 0) return false;
  return others.every(([, readAt]) => readAt >= message.createdAt!);
}

export function receiptFor(message: Message, memberReadAt: Record<string, number>, selfId: string | null): "sent" | "read" | null {
  if (!message.mine) return null;
  return isReadByEveryone(message, memberReadAt, selfId) ? "read" : "sent";
}

/**
 * Whether an arriving message may be stamped as read.
 *
 * A message that lands while the app is open but the conversation is not being looked at
 * has not been read. Stamping it told the sender two ticks for something no person had
 * seen, and it is the sender who then waited for a reply that was never coming.
 *
 * Three things have to hold: the conversation is the open one, the phone is not showing
 * the chat list instead of it, and the tab is in front of the reader.
 */
export function canMarkRead(state: {
  chatOpen: boolean;
  conversationOnScreen: boolean;
  documentVisible: boolean;
}): boolean {
  return state.chatOpen && state.conversationOnScreen && state.documentVisible;
}
