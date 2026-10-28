import { fetchLatestMessages, fetchOlderMessages, mapMessageRow } from "../lib/messageSync";
import type { HistoryCursor } from "../lib/history";
import type { Message } from "../types";

export const DEFAULT_MESSAGE_PAGE_SIZE = 50;

type LoadOptions = {
  chatId: string;
  accountId: string;
  selfName: string;
  authorName: string;
  pageSize?: number;
};

/** Loads the newest page of the chat together with reaction emojis. */
export async function loadMessagePage({
  chatId,
  accountId,
  selfName,
  authorName,
  pageSize = DEFAULT_MESSAGE_PAGE_SIZE,
}: LoadOptions): Promise<Message[] | null> {
  const rows = await fetchLatestMessages(chatId, pageSize);
  if (!rows) return null;
  const mapped = await Promise.all(rows.map((row) => mapMessageRow(row, { accountId, selfName, authorName })));
  const messages = mapped.filter((item): item is Message => item !== null).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return messages;
}

/** Loads one older page before the cursor and returns it in ascending order. */
export async function loadOlderMessagePage(options: LoadOptions & { cursor: HistoryCursor }): Promise<Message[] | null> {
  const { chatId, accountId, selfName, authorName, cursor, pageSize = DEFAULT_MESSAGE_PAGE_SIZE } = options;
  const rows = await fetchOlderMessages(chatId, cursor, pageSize);
  if (!rows) return null;
  const mapped = await Promise.all(rows.map((row) => mapMessageRow(row, { accountId, selfName, authorName })));
  return mapped.filter((item): item is Message => item !== null).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}
