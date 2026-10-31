import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { isAvatarPath } from "../lib/avatar";

const TTL_SECONDS = 3600;
const REFRESH_MS = TTL_SECONDS * 900;
const cache = new Map<string, { url: string; at: number }>();
const inFlight = new Map<string, Promise<string | null>>();
let generation = 0;

async function resolve(path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < REFRESH_MS) return cached.url;
  if (inFlight.has(path)) return inFlight.get(path)!;
  const started = generation;
  const request = (async () => {
    try {
      if (!supabase) return null;
      const { data, error } = await supabase.storage.from("avatars").createSignedUrl(path, TTL_SECONDS);
      if (error || !data?.signedUrl || started !== generation) return null;
      cache.set(path, { url: data.signedUrl, at: Date.now() });
      return data.signedUrl;
    } catch { return null; }
  })();
  inFlight.set(path, request);
  try { return await request; }
  finally { if (inFlight.get(path) === request) inFlight.delete(path); }
}

export function useAvatarUrl(storedPath: string | null | undefined): string | null {
  const path = isAvatarPath(storedPath) ? storedPath! : null;
  const [state, setState] = useState<{ path: string | null; url: string | null }>({ path: null, url: null });
  useEffect(() => {
    if (!path) { setState({ path: null, url: null }); return; }
    let alive = true;
    let refreshing = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!alive || refreshing) return;
      refreshing = true;
      clearTimeout(timer);
      const next = await resolve(path);
      refreshing = false;
      if (!alive) return;
      const saved = cache.get(path);
      const valid = saved && Date.now() - saved.at < TTL_SECONDS * 1000 ? saved.url : null;
      setState({ path, url: next ?? valid });
      timer = setTimeout(() => void refresh(), next && saved ? Math.max(1000, saved.at + REFRESH_MS - Date.now()) : 30_000);
    };
    const wake = () => { if (document.visibilityState !== "hidden") void refresh(); };
    void refresh();
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("nexus-avatar-cache-cleared", wake);
    document.addEventListener("visibilitychange", wake);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener("online", wake); window.removeEventListener("focus", wake); window.removeEventListener("nexus-avatar-cache-cleared", wake); document.removeEventListener("visibilitychange", wake); };
  }, [path]);
  return state.path === path ? state.url : null;
}

export function avatarCacheSize(): number { return cache.size; }
export function clearAvatarCache(): void {
  generation++;
  cache.clear();
  inFlight.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("nexus-avatar-cache-cleared"));
}
