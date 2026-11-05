import { fetchRecoveryMessages } from "./messageRecovery";
import { fetchKnownMessages, fetchReactions, fetchLatestMessages, mapMessageRow } from "./messageSync";
import { DEFAULT_MESSAGE_PAGE_SIZE, type LoadOptions } from "./messageLoader";
import type { Message } from "../types";
export { reconcileMessageSnapshot } from "./messageReconcile";

/** Existing rows plus the latest page; never interpret a failed request as deletions. */
export async function loadMessageSnapshot(options: LoadOptions, ids: string[], since?: number): Promise<Message[] | null> {
  try {
    const [latest, known] = await Promise.all([
      since === undefined ? fetchLatestMessages(options.chatId, options.pageSize ?? DEFAULT_MESSAGE_PAGE_SIZE) : fetchRecoveryMessages(options.chatId, since),
      fetchKnownMessages(options.chatId, ids),
    ]);
    if (!latest || !known) return null;
    const checked = new Set(ids);
    // The explicit ID lookup wins if a row disappeared after the latest-page query.
    const rows = [...new Map([...latest.filter(row => !checked.has(row.id)), ...known].map(row => [row.id, row])).values()];
    const reactions: Record<string,string[]> = {};
    const mapped: (Message | null)[] = [];
    for (let offset = 0; offset < rows.length; offset += 50) {
      const batch = rows.slice(offset, offset + 50);
      Object.assign(reactions, await fetchReactions(batch.map(row => row.id), true));
      mapped.push(...await Promise.all(batch.map(row => mapMessageRow(row, options))));
    }
    return mapped.filter((message): message is Message => message !== null)
      .map(message => ({ ...message, reactions: reactions[message.remoteId!] ?? [] }));
  } catch {
    // Keep the visible snapshot on transport/signing failures as well as API errors.
    return null;
  }
}
