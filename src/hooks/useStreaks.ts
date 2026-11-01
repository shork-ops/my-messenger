import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { demoSeedEnabled } from "../lib/constants";
import type { StreakRow, StreakView } from "../lib/streakEngine";
import type { Chat } from "../types";

type Engine = typeof import("../lib/streakEngine");

/** Long enough for the database to have written the note of the message just sent. */
const REFRESH_DELAY_MS = 1200;
const BURST_MS = 2400;

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const isDirect = (chat: Chat) => !chat.group && !chat.channel;

/**
 * «Огонёк дружбы» for the chat list and the header: ready-made badges by local chat id, and
 * the chat whose fire has just grown.
 *
 * Asked again a moment after any direct chat gets a new message, when the tab comes back, and
 * just after midnight, when "today" changes. Before the migration is applied the call fails;
 * that is not an error worth showing, so there are simply no badges. The reading of the answer
 * is a separate chunk, fetched once there is something to read.
 */
export function useStreaks(chats: Chat[], accountId: string | null, notify: (text: string) => void) {
  const [rows, setRows] = useState<StreakRow[]>([]);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [tick, setTick] = useState(0);
  const [burstId, setBurstId] = useState<number | null>(null);
  const seen = useRef<Record<string, number> | null>(null);

  const signal = chats
    .filter((chat) => chat.remoteId && isDirect(chat))
    .map((chat) => `${chat.remoteId}:${chat.messages[chat.messages.length - 1]?.id ?? ""}`)
    .join("|");

  useEffect(() => {
    const client = supabase;
    if (!client || !accountId || !signal) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void client.rpc("my_streaks", { p_tz: timeZone() }).then(
        ({ data, error }) => {
          if (!cancelled && !error && Array.isArray(data)) setRows(data as StreakRow[]);
        },
        () => undefined
      );
    }, REFRESH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accountId, signal, tick]);

  useEffect(() => {
    if (engine || (!demoSeedEnabled && rows.length === 0)) return;
    void import("../lib/streakEngine").then((loaded) => setEngine(() => loaded), () => undefined);
  }, [engine, rows]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setTick((value) => value + 1);
    };
    document.addEventListener("visibilitychange", refresh);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const timer = window.setTimeout(() => setTick((value) => value + 1), midnight.getTime() - now.getTime());
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.clearTimeout(timer);
    };
  }, [tick]);

  const streaks = useMemo(
    () => (engine ? engine.streakViews(chats, demoSeedEnabled ? null : rows, new Date()) : new Map<number, StreakView>()),
    // `tick` re-reads "today" after midnight and when the tab comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, chats, rows, tick]
  );

  useEffect(() => {
    if (!engine) return;
    seen.current ??= engine.readSeenLevels();
    const found = engine.celebration(chats, streaks, seen.current);
    if (found) {
      notify(found.message);
      setBurstId(found.chatId);
    }
    // `notify` is a new function on every render; the streaks are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaks]);

  useEffect(() => {
    if (burstId === null) return;
    const timer = window.setTimeout(() => setBurstId(null), BURST_MS);
    return () => window.clearTimeout(timer);
  }, [burstId]);

  return { streaks, burstId };
}
