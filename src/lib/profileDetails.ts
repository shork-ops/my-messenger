import type { SupabaseClient } from "@supabase/supabase-js";

/** A person's photo and "about" line, as far as they let the reader see them. */
export type ProfileDetails = { avatar_path: string | null; about: string | null };

/**
 * Columns of `profiles` their owners may hide, read through the database function that applies
 * the owner's rule: a hidden value arrives as null, the same as "not set". Until the migration
 * that closes the columns has been run the function does not exist and the columns are still
 * readable directly, which keeps the app working whichever goes first, the site or the SQL.
 */
async function readGuarded<T>(client: SupabaseClient, fn: string, columns: string, ids: string[]): Promise<Map<string, T>> {
  const found = new Map<string, T>();
  if (ids.length === 0) return found;
  let { data, error } = await client.rpc(fn, { user_ids: ids });
  if (error) ({ data, error } = await client.from("profiles").select(`id, ${columns}`).in("id", ids));
  for (const row of (error ? null : (data as ({ id: string } & T)[] | null)) ?? []) found.set(row.id, row);
  return found;
}

/** Photos and "about" lines, each by the rule its owner chose: all, contacts, nobody (20261057). */
export async function fetchProfileDetails(client: SupabaseClient, ids: string[]): Promise<Map<string, ProfileDetails>> {
  const found = await readGuarded<ProfileDetails>(client, "profile_details", "avatar_path, about", ids);
  for (const [id, row] of found) found.set(id, { avatar_path: row.avatar_path ?? null, about: row.about ?? null });
  return found;
}

/**
 * When these people were last online, in milliseconds, 0 when it is not known. The database
 * gives the time only to someone who shares a personal chat with its owner, and to nobody when
 * the owner hid it or across a block (20261058); the app then shows «был(а) недавно».
 */
export async function fetchLastSeen(client: SupabaseClient, ids: string[]): Promise<Map<string, number>> {
  const found = await readGuarded<{ last_seen_at: string | null }>(client, "last_seen_of", "last_seen_at", ids);
  return new Map([...found].map(([id, row]) => [id, Date.parse(row.last_seen_at ?? "") || 0]));
}
