import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { UserSearchResult } from "../types";

type UseUserSearchOptions = { search: string; accountId: string | null };

export function useUserSearch({ search, accountId }: UseUserSearchOptions) {
  const [foundUsers, setFoundUsers] = useState<UserSearchResult[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);

  useEffect(() => {
    const client = supabase;
    const query = search.trim().replace(/^@/, "").toLowerCase();
    if (!client || query.length < 3) {
      setFoundUsers([]);
      setUserSearchLoading(false);
      return;
    }
    let alive = true;
    setUserSearchLoading(true);
    const timer = window.setTimeout(async () => {
      const { data, error } = await client.from("profiles").select("id, username, display_name, avatar").ilike("username", `${query}%`).limit(8);
      if (!alive) return;
      setUserSearchLoading(false);
      if (error) {
        setFoundUsers([]);
        return;
      }
      setFoundUsers((data ?? []).filter((user) => user.id !== accountId && Boolean(user.username)) as UserSearchResult[]);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [search, accountId]);

  return { foundUsers, userSearchLoading };
}
