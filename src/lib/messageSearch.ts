import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side search over a chat's full history.
 *
 * The client used to filter only the messages it had already downloaded, so
 * anything older than the first page was invisible. Postgres now owns the
 * search (`20261035_message_search.sql`): the index is a generated tsvector,
 * and `search_messages` enforces chat membership.
 */
export type SearchHit = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  edited: boolean;
  /** Body fragment with <mark>…</mark> markers already inserted by Postgres. */
  headline: string;
};

export type SearchResult =
  | { ok: true; hits: SearchHit[]; hasMore: boolean }
  | { ok: false; message: string };

export const SEARCH_PAGE_SIZE = 30;

/** Postgres only ever returns our own markers, so this is a formatting step, not sanitising HTML. */
export function splitHeadline(headline: string): { text: string; marked: boolean }[] {
  return headline
    .split(/(<mark>[\s\S]*?<\/mark>)/g)
    .filter((part) => part.length > 0)
    .map((part) =>
      part.startsWith("<mark>") && part.endsWith("</mark>")
        ? { text: part.slice(6, -7), marked: true }
        : { text: part, marked: false }
    );
}

type RawHit = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  headline: string;
};

export async function searchMessages(
  client: SupabaseClient,
  chatId: string,
  query: string,
  offset = 0
): Promise<SearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, hits: [], hasMore: false };

  // Ask for one extra row so "hasMore" needs no separate count query.
  const { data, error } = await client.rpc("search_messages", {
    target_chat_id: chatId,
    search_query: trimmed,
    page_size: SEARCH_PAGE_SIZE + 1,
    page_offset: offset,
  });

  if (error) {
    if (/42501|Not a member/i.test(error.message)) {
      return { ok: false, message: "Поиск доступен только участникам чата" };
    }
    return { ok: false, message: error.message };
  }

  const rows = (data ?? []) as RawHit[];
  const hasMore = rows.length > SEARCH_PAGE_SIZE;
  return {
    ok: true,
    hasMore,
    hits: rows.slice(0, SEARCH_PAGE_SIZE).map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      body: row.body,
      createdAt: row.created_at,
      edited: Boolean(row.edited_at),
      headline: row.headline ?? row.body,
    })),
  };
}
