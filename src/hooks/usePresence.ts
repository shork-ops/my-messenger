import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type UsePresenceOptions = { accountId: string | null; profileName: string };

export function usePresence({ accountId, profileName }: UsePresenceOptions) {
  const [onlineIds, setOnlineIds] = useState<string[]>([]);

  useEffect(() => {
    const client = supabase;
    if (!client || !accountId) {
      setOnlineIds([]);
      return;
    }
    const channel = client.channel("nexus-presence", { config: { presence: { key: accountId } } });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(Object.keys(channel.presenceState()));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void channel.track({ name: profileName, at: Date.now() });
      });
    return () => {
      setOnlineIds([]);
      void client.removeChannel(channel);
    };
  }, [accountId, profileName]);

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
