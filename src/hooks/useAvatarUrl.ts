import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { isAvatarPath } from "../lib/avatar";

const TTL_SECONDS = 60 * 60;

/**
 * Signed avatar URLs, cached across the whole app.
 *
 * A chat list with 40 conversations would otherwise fire 40 signing requests on
 * every mount, and each would produce a different URL. One cache means one
 * request per unique path and stable URLs, so images are not refetched.
 */
const cache = new Map<string, { url: string; at: number }>();
const listeners = new Map<string, Set<(url: string | null) => void>>();

function publish(path: string, url: string | null) {
  const set = listeners.get(path);
  if (!set) return;
  for (const notify of set) notify(url);
}

async function resolve(path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < TTL_SECONDS * 1000 * 0.9) return cached.url;
  const client = supabase;
  if (!client) return null;
  const { data, error } = await client.storage.from("avatars").createSignedUrl(path, TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, at: Date.now() });
  return data.signedUrl;
}

/** Resolves one avatar path to a signed URL. Returns null for letters and on failure. */
export function useAvatarUrl(storedPath: string | null | undefined): string | null {
  const path = isAvatarPath(storedPath) ? (storedPath as string) : null;
  const [url, setUrl] = useState<string | null>(() => (path ? cache.get(path)?.url ?? null : null));

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    const cached = cache.get(path);
    if (cached && Date.now() - cached.at < TTL_SECONDS * 1000 * 0.9) {
      setUrl(cached.url);
      return;
    }
    let alive = true;
    const entry = listeners.get(path) ?? new Set();
    const handler = (next: string | null) => {
      if (alive) setUrl(next);
    };
    entry.add(handler);
    listeners.set(path, entry);
    void resolve(path).then((next) => {
      publish(path, next);
      if (entry.size === 0) listeners.delete(path);
    });
    return () => {
      alive = false;
      entry.delete(handler);
    };
  }, [path]);

  return url;
}

/** Test/debug helper: how many paths are currently cached. */
export function avatarCacheSize(): number {
  return cache.size;
}

/** Drops the cache. Used when the signed-in user changes. */
export function clearAvatarCache(): void {
  cache.clear();
}
