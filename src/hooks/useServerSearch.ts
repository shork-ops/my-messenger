import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { SEARCH_PAGE_SIZE, searchMessages, splitHeadline } from "../lib/messageSearch";
import type { SearchHit } from "../lib/messageSearch";

type UseServerSearchOptions = {
  chatId: string | null;
  query: string;
  /** Search only makes sense for cloud chats that may have undownloaded history. */
  enabled: boolean;
};

/**
 * Debounced full-history search for the open chat.
 *
 * Local filtering stays in place for the messages already on screen; this hook
 * adds the hits that live further back than the loaded page.
 */
export function useServerSearch({ chatId, query, enabled }: UseServerSearchOptions) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const trimmed = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    // Every new query invalidates in-flight responses, so a slow earlier
    // request cannot overwrite the results of a later one.
    const current = ++requestId.current;
    if (!enabled || !chatId || trimmed.length < 2) {
      setHits([]);
      setHasMore(false);
      setLoading(false);
      setError("");
      return;
    }

    const client = supabase;
    if (!client) {
      setHits([]);
      setHasMore(false);
      return;
    }

    setLoading(true);
    const timer = window.setTimeout(async () => {
      const result = await searchMessages(client, chatId, trimmed, 0);
      if (current !== requestId.current) return;
      if (result.ok) {
        setHits(result.hits);
        setHasMore(result.hasMore);
        setError("");
      } else {
        setHits([]);
        setHasMore(false);
        setError(result.message);
      }
      setLoading(false);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [chatId, trimmed, enabled]);

  async function loadMore() {
    const client = supabase;
    if (!client || !chatId || !trimmed || !hasMore || loading) return;
    const current = requestId.current;
    setLoading(true);
    const result = await searchMessages(client, chatId, trimmed, hits.length);
    if (current !== requestId.current) return;
    if (result.ok) {
      setHits((previous) => [...previous, ...result.hits]);
      setHasMore(result.hasMore);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }

  return { hits, hasMore, loading, error, loadMore, pageSize: SEARCH_PAGE_SIZE, splitHeadline };
}
