import { useEffect, useRef } from "react";
import type { Chat } from "../types";
import { supabase } from "../lib/supabase";
import { SIGNED_URL_TTL_SECONDS } from "../lib/messageSync";
import { collectExpiringAttachments, nextRefreshDelay, withRefreshedUrl } from "../lib/attachmentUrls";

type UseAttachmentRefreshOptions = {
  chats: Chat[];
  enabled: boolean;
  setChats: (updater: (current: Chat[]) => Chat[]) => void;
};

/**
 * Keeps signed attachment URLs alive for as long as the tab is open.
 *
 * A signed URL lasts an hour. Before this hook existed, a tab left open
 * overnight showed broken images and silent voice messages: the URL was only
 * ever created when a message row was mapped, which happens on load and on new
 * realtime messages. Refreshing shortly before expiry fixes that without
 * re-downloading history.
 */
export function useAttachmentRefresh({ chats, enabled, setChats }: UseAttachmentRefreshOptions) {
  // The effect must not restart every time a message arrives, so the latest
  // chats are read through a ref instead of a dependency.
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  useEffect(() => {
    const client = supabase;
    if (!enabled || !client) return;

    let timer: number | undefined;
    let cancelled = false;

    const schedule = () => {
      const delay = nextRefreshDelay(chatsRef.current, Date.now());
      if (delay === null) return;
      timer = window.setTimeout(refreshDue, delay);
    };

    const refreshDue = async () => {
      if (cancelled) return;
      // Collect paths first, then dedupe: an album can share one path.
      const due = collectExpiringAttachments(chatsRef.current, Date.now());
      const uniquePaths = [...new Set(due.map((item) => item.path))];
      const urls = new Map<string, string>();
      await Promise.all(
        uniquePaths.map(async (path) => {
          const { data } = await client.storage.from("chat-media").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
          if (data?.signedUrl) urls.set(path, data.signedUrl);
        })
      );

      if (cancelled) return;
      const expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
      const refreshed = due.filter((item) => urls.has(item.path));
      if (refreshed.length > 0) {
        setChats((current) =>
          refreshed.reduce(
            (acc, item) => withRefreshedUrl(acc, { chatId: item.chatId, messageId: item.messageId }, urls.get(item.path)!, expiresAt),
            current
          )
        );
      }
      schedule();
    };

    // A tab that was in the background wakes up with stale timers, so re-check
    // as soon as it becomes visible again.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      void refreshDue();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, setChats]);
}
