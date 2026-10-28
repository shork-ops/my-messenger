import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type TypingUser = { id: string; name: string };

type UseTypingOptions = {
  remoteId?: string;
  accountId: string | null;
  profileName: string;
};

const TYPING_TTL_MS = 4000;
const TYPING_THROTTLE_MS = 1500;

export function useTyping({ remoteId, accountId, profileName }: UseTypingOptions) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    const client = supabase;
    setTypingUsers([]);
    if (!client || !accountId || !remoteId) return;
    const channel = client
      .channel(`nexus-typing-${remoteId}`)
      .on("broadcast", { event: "typing" }, (payload) => {
        const data = payload.payload as { userId?: string; name?: string };
        if (!data.userId || data.userId === accountId || !data.name) return;
        setTypingUsers((current) => [...current.filter((entry) => entry.id !== data.userId), { id: data.userId!, name: data.name! }]);
        window.setTimeout(() => {
          setTypingUsers((current) => current.filter((entry) => entry.id !== data.userId));
        }, TYPING_TTL_MS);
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      setTypingUsers([]);
      void client.removeChannel(channel);
    };
  }, [remoteId, accountId]);

  function notifyTyping() {
    const channel = channelRef.current;
    if (!channel || !accountId) return;
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_THROTTLE_MS) return;
    lastSentRef.current = now;
    void channel.send({ type: "broadcast", event: "typing", payload: { userId: accountId, name: profileName } });
  }

  return { typingUsers, notifyTyping };
}
