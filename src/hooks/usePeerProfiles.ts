import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../lib/supabase";
import { fetchLastSeen, fetchProfileDetails } from "../lib/profileDetails";
import type { Chat } from "../types";

export function usePeerProfiles({ accountId, chats, setChats }: { accountId: string | null; chats: Chat[]; setChats: Dispatch<SetStateAction<Chat[]>> }) {
  const peers = [...new Set(chats.map(c => c.peerId).filter(Boolean))].sort().join(",");
  useEffect(() => {
    const client = supabase;
    if (!client || !accountId || !peers) return;
    let alive = true;
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      const ids = peers.split(",");
      // The photo and the "about" line come by the owner's rule (20261057), «был(а) в сети» too
      // (20261058) - read again here so the header does not keep the time the list loaded with.
      // A reply that did not come at all keeps what is on screen rather than wiping it.
      const [{ data, error }, details, seen] = await Promise.all([
        client.from("profiles").select("id, display_name, avatar").in("id", ids),
        fetchProfileDetails(client, ids),
        fetchLastSeen(client, ids),
      ]);
      if (!alive || error || !data) return;
      setChats(all => all.map(chat => {
        const peer = data.find(p => p.id === chat.peerId);
        if (!peer || chat.group) return chat;
        const extra = details.get(peer.id);
        const avatarPath = extra ? extra.avatar_path : chat.avatarPath ?? null;
        const about = extra ? extra.about : chat.about ?? null;
        const lastSeen = seen.get(peer.id) ?? chat.memberLastSeenAt?.[peer.id] ?? 0;
        if (chat.name === peer.display_name && chat.avatar === peer.avatar && chat.avatarPath === avatarPath && (chat.about ?? null) === about && (chat.memberLastSeenAt?.[peer.id] ?? 0) === lastSeen) return chat;
        return { ...chat, name: peer.display_name, avatar: peer.avatar, avatarPath, about, memberLastSeenAt: { ...chat.memberLastSeenAt, [peer.id]: lastSeen } };
      }));
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const wake = () => void refresh();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    const channel = client.channel(`peer-profiles-${accountId}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, wake).subscribe();
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake); void client.removeChannel(channel); };
  }, [accountId, peers, setChats]);
}
