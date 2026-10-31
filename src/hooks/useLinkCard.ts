import { useEffect, useMemo, useState } from "react";
import { cardIsUsable, type LinkCard } from "../lib/links";
import { isDemoMode } from "../lib/constants";
import { supabase } from "../lib/supabase";
import { scopedStore, type ScopedStore } from "../lib/scopedStorage";

/**
 * Fetches the preview card for one link.
 *
 * Caching lives here rather than on the server: the browser already has a session, and a
 * card that is remembered per URL in this browser costs one request per link instead of one
 * per conversation. A failed card is remembered too, so a dead link is not re-fetched every
 * time the conversation opens.
 */

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; card: LinkCard }
  | { status: "none" };

const CACHE_PREFIX = "nexus-link-card:";

/**
 * The preview cache, per account.
 *
 * A link card records a URL somebody was sent. Cached under one shared key, the second person to
 * use this browser finds a preview for a conversation they never had — so the cache lives in the
 * account's namespace and the entry key carries the URL inside it.
 */
function readCache(store: ScopedStore, url: string): LinkCard | "none" | null {
  const raw = store.read(CACHE_PREFIX + url);
  if (raw === null) return null;
  if (raw === "none") return "none";
  try {
    const parsed = JSON.parse(raw) as LinkCard;
    return parsed && typeof parsed.title === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(store: ScopedStore, url: string, value: LinkCard | "none"): void {
  // The "none" marker is a plain string, not JSON, so it survives the empty-value pruning in
  // scopedStore deliberately: a dead link must stay remembered rather than be re-fetched.
  store.write(CACHE_PREFIX + url, typeof value === "string" ? value : JSON.stringify(value));
}

export function useLinkCard(url: string | null, enabled: boolean, accountId: string | null): State {
  const [state, setState] = useState<State>({ status: "idle" });
  const store = useMemo(() => scopedStore(accountId), [accountId]);

  useEffect(() => {
    if (!url || !enabled) {
      setState({ status: "idle" });
      return;
    }
    const cached = readCache(store, url);
    if (cached === "none") {
      setState({ status: "none" });
      return;
    }
    if (cached) {
      setState({ status: "ready", card: cached });
      return;
    }

    // Nothing to fetch in the demo build: the preview needs a signed-in session and a real
    // Supabase project, and inventing a card would make the demo lie about a network call.
    if (isDemoMode) {
      setState({ status: "none" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      const client = supabase;
      if (!client) {
        if (!cancelled) setState({ status: "none" });
        return;
      }
      const { data, error } = await client.functions.invoke("link-preview", { body: { url } });
      if (cancelled) return;
      const card = (data ?? null) as LinkCard | null;
      if (error || !card || "error" in card || !cardIsUsable(card)) {
        writeCache(store, url, "none");
        setState({ status: "none" });
        return;
      }
      writeCache(store, url, card);
      setState({ status: "ready", card });
    })();

    return () => {
      cancelled = true;
    };
  }, [url, enabled, store]);

  return state;
}
