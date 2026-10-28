import type { Message } from "../types";

/**
 * Keyset cursor for loading older history: the whole tuple `(created_at, id)` is sent back
 * to Supabase so messages created in the same millisecond are never skipped or duplicated.
 */
export type HistoryCursor = { createdAt: string; id: string };

/** Returns the cursor of the oldest loaded message, or null when its server id is unknown. */
export function olderThanCursor(messages: Message[]): HistoryCursor | null {
  const oldest = messages[0];
  if (!oldest?.remoteId || !oldest.createdAt) return null;
  return { createdAt: new Date(oldest.createdAt).toISOString(), id: oldest.remoteId };
}

/** A page can be requested while the first message came from the server and nothing is loading. */
export function canLoadOlder(messages: Message[], loading: boolean, exhausted: boolean): boolean {
  return !loading && !exhausted && messages.length > 0 && Boolean(messages[0]?.remoteId);
}

/** Merges an older page in front of the current list, dropping duplicates by `remoteId`. */
export function prependOlderMessages(current: Message[], older: Message[]): Message[] {
  if (older.length === 0) return current;
  const remotes = new Set(current.map((message) => message.remoteId).filter((id): id is string => Boolean(id)));
  const numbers = new Set(current.map((message) => message.id));
  const unique = older.filter(
    (message) => (message.remoteId ? !remotes.has(message.remoteId) : true) && !numbers.has(message.id)
  );
  return unique.length === 0 ? current : [...unique, ...current];
}
