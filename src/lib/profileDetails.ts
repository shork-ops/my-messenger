import type { SupabaseClient } from "@supabase/supabase-js";

/** A person's photo and "about" line, as far as they let the reader see them. */
export type ProfileDetails = { avatar_path: string | null; about: string | null };

/**
 * Photos and "about" lines of these people, each by the rule its owner chose (all, contacts,
 * nobody). The database applies the rule (migration 20261057), so a hidden value arrives as
 * null - the same as "not set". Until that migration has been run the columns are still
 * readable directly, which keeps the app working whichever goes first, the site or the SQL.
 */
export async function fetchProfileDetails(client: SupabaseClient, ids: string[]): Promise<Map<string, ProfileDetails>> {
  const found = new Map<string, ProfileDetails>();
  if (ids.length === 0) return found;
  let { data, error } = await client.rpc("profile_details", { user_ids: ids });
  if (error) ({ data, error } = await client.from("profiles").select("id, avatar_path, about").in("id", ids));
  for (const row of (error ? null : (data as ({ id: string } & ProfileDetails)[] | null)) ?? []) {
    found.set(row.id, { avatar_path: row.avatar_path ?? null, about: row.about ?? null });
  }
  return found;
}
