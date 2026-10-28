import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { fetchChatMembers } from "../lib/groupAdmin";
import type { ChatMember } from "../lib/groupAdmin";

type UseChatMembersOptions = {
  chatId: string | null;
  isGroup: boolean;
  /** Bumped after a role change or removal so the list refetches. */
  refreshKey?: number;
};

/**
 * Loads the member list (with roles) for the open group.
 * Direct chats skip the request entirely.
 */
export function useChatMembers({ chatId, isGroup, refreshKey = 0 }: UseChatMembersOptions) {
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    const client = supabase;
    if (!client || !chatId || !isGroup) {
      setMembers([]);
      return;
    }
    setLoading(true);
    const result = await fetchChatMembers(client, chatId);
    setMembers(result.ok ? result.data : []);
    setLoading(false);
  }, [chatId, isGroup]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  return { members, loading, reload };
}
