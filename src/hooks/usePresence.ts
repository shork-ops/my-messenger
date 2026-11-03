import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

/**
 * Who is online now, and this account's own "online".
 *
 * `announce` is false for someone who hid «был(а) в сети», and until their choice is known: they
 * still see who is online, but nobody sees them - the same as Telegram does. Whoever is not
 * announced is not in the channel at all, so no other client, modified or not, can see them there.
 */
export function usePresence({ accountId, announce }: { accountId: string | null; announce: boolean }) {
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const announceRef = useRef(announce);
  announceRef.current = announce;

  useEffect(() => {
    const client = supabase;
    if (!client || !accountId) {
      setOnlineIds([]);
      return;
    }
    const channel = client.channel("nexus-presence", { config: { presence: { key: accountId } } });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(Object.keys(channel.presenceState()));
      })
      .subscribe((status) => {
        // Joining again after a lost connection announces again, if it still should.
        if (status === "SUBSCRIBED" && announceRef.current) void channel.track({ at: Date.now() });
      });
    return () => {
      channelRef.current = null;
      setOnlineIds([]);
      void client.removeChannel(channel);
    };
  }, [accountId]);

  // The switch turned in Settings takes effect at once, without leaving the channel. Before the
  // channel has joined there is nothing to change: joining reads the switch itself.
  useEffect(() => {
    const channel = channelRef.current;
    if (channel?.state === "joined") void (announce ? channel.track({ at: Date.now() }) : channel.untrack());
  }, [announce]);

  useEffect(() => {
    const client = supabase;
    if (!client || !accountId) return;
    const stamp = () => {
      void client.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", accountId);
    };
    stamp();
    const timer = window.setInterval(stamp, 60000);
    return () => window.clearInterval(timer);
  }, [accountId]);

  return { onlineIds };
}
