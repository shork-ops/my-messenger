import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../lib/supabase";
import type { Chat } from "../types";

export function usePeerProfiles({ accountId, chats, setChats }: { accountId: string | null; chats: Chat[]; setChats: Dispatch<SetStateAction<Chat[]>> }) {
  const peers = [...new Set(chats.map(c => c.peerId).filter(Boolean))].sort().join(",");
  useEffect(() => {
    const client = supabase;
    if (!client || !accountId || !peers) return;
    let alive = true;
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      const { data, error } = await client.from("profiles").select("id, display_name, avatar, avatar_path").in("id", peers.split(","));
      if (!alive || error || !data) return;
      setChats(all => all.map(chat => {
        const peer = data.find(p => p.id === chat.peerId);
        if (!peer || chat.group) return chat;
        if (chat.name === peer.display_name && chat.avatar === peer.avatar && chat.avatarPath === peer.avatar_path) return chat;
        return { ...chat, name: peer.display_name, avatar: peer.avatar, avatarPath: peer.avatar_path };
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
