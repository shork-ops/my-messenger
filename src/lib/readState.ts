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
