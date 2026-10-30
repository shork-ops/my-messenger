import { useEffect, useState } from "react";
import { cardIsUsable, type LinkCard } from "../lib/links";
import { isDemoMode } from "../lib/constants";
import { supabase } from "../lib/supabase";

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

function readCache(url: string): LinkCard | "none" | null {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + url);
    if (raw === null) return null;
    if (raw === "none") return "none";
    const parsed = JSON.parse(raw) as LinkCard;
    return parsed && typeof parsed.title === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(url: string, value: LinkCard | "none"): void {
  try {
    window.localStorage.setItem(CACHE_PREFIX + url, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    // Storage full or private mode: the card is simply fetched again later.
  }
}

export function useLinkCard(url: string | null, enabled: boolean): State {
  const [state, setState] = useState<State>({ status: "idle" });

  useEffect(() => {
    if (!url || !enabled) {
      setState({ status: "idle" });
      return;
    }
    const cached = readCache(url);
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
        writeCache(url, "none");
        setState({ status: "none" });
        return;
      }
      writeCache(url, card);
      setState({ status: "ready", card });
    })();

    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  return state;
}
