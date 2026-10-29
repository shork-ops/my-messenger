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
      // Through the function, not the table: the table has no way to apply the
      // owner's visibility choice, and a hidden profile would still come back.
      const { data, error } = await client.rpc("search_profiles", { term: query });
      if (!alive) return;
      setUserSearchLoading(false);
      if (error) {
        setFoundUsers([]);
        return;
      }
      setFoundUsers(
        ((data ?? []) as UserSearchResult[]).filter((user) => user.id !== accountId && Boolean(user.username))
      );
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [search, accountId]);

  return { foundUsers, userSearchLoading };
}
