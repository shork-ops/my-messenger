import type { Message } from "../types";

/** Preserve PostgreSQL sub-millisecond ordering before using the ID tie-breaker. */
export function compareMessages(a: Message, b: Message): number {
  const time = (a.createdAt ?? 0) - (b.createdAt ?? 0);
  if (time) return time;
  const fraction = (value?: string) => (value?.match(/\.(\d+)/)?.[1] ?? "").padEnd(6,"0").slice(3,6);
  return fraction(a.historyAt).localeCompare(fraction(b.historyAt))
    || (a.remoteId && b.remoteId ? a.remoteId.localeCompare(b.remoteId) : a.id-b.id);
}

/** Insert a server-confirmed message using the same order as history pages. */
export function placeNewMessage(messages: Message[], fresh: Message): Message[] {
  if (fresh.createdAt === undefined) return [...messages,fresh];
  const index = messages.findIndex(message=>message.createdAt !== undefined && compareMessages(message,fresh)>0);
  const at = index<0 ? messages.length : index;
  return [...messages.slice(0,at),fresh,...messages.slice(at)];
}
