import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Privacy settings and the block list.
 *
 * Preferences live on the profile so they follow the user between devices;
 * the checks themselves run in Postgres (`20261037_privacy.sql`), which means a
 * modified client cannot send to someone who blocked it.
 */
export type PrivacyPreferences = {
  hideLastSeen: boolean;
  disableReadReceipts: boolean;
};

export type BlockResult = { ok: true } | { ok: false; message: string };

export const DEFAULT_PRIVACY: PrivacyPreferences = {
  hideLastSeen: false,
  disableReadReceipts: false,
};

export function describeBlockError(message: string): string {
  if (/cannot block yourself/i.test(message)) return "Нельзя заблокировать себя";
  if (/not available/i.test(message)) return "Этот пользователь недоступен";
  return message;
}

export async function fetchPrivacyPreferences(
  client: SupabaseClient,
  userId: string
): Promise<PrivacyPreferences> {
  const { data, error } = await client
    .from("profiles")
    .select("hide_last_seen, disable_read_receipts")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return DEFAULT_PRIVACY;
  return {
    hideLastSeen: Boolean(data.hide_last_seen),
    disableReadReceipts: Boolean(data.disable_read_receipts),
  };
}

export async function savePrivacyPreferences(
  client: SupabaseClient,
  userId: string,
  preferences: PrivacyPreferences
): Promise<BlockResult> {
  const { error } = await client
    .from("profiles")
    .update({
      hide_last_seen: preferences.hideLastSeen,
      disable_read_receipts: preferences.disableReadReceipts,
    })
    .eq("id", userId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function blockUser(client: SupabaseClient, userId: string): Promise<BlockResult> {
  const { error } = await client.rpc("block_user", { target_user_id: userId });
  if (error) return { ok: false, message: describeBlockError(error.message) };
  return { ok: true };
}

export async function unblockUser(client: SupabaseClient, userId: string): Promise<BlockResult> {
  const { error } = await client.rpc("unblock_user", { target_user_id: userId });
  if (error) return { ok: false, message: describeBlockError(error.message) };
  return { ok: true };
}

/** Ids the current user has blocked. */
export async function fetchBlockedIds(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from("user_blocks").select("blocked_id");
  if (error || !data) return [];
  return data.map((row) => row.blocked_id as string);
}

/**
 * Read receipts carry the reader's id. When the reader turned receipts off,
 * the sender must not learn when (or whether) it was read, so those entries are
 * removed before the sender ever sees them.
 */
export function stripHiddenReceipts(
  memberReadAt: Record<string, number>,
  hiddenReaderIds: string[]
): Record<string, number> {
  if (hiddenReaderIds.length === 0) return memberReadAt;
  const hidden = new Set(hiddenReaderIds);
  return Object.fromEntries(Object.entries(memberReadAt).filter(([userId]) => !hidden.has(userId)));
}

/** True when the peer hid their last seen, so the UI should show "недавно". */
export function lastSeenIsHidden(timestamp: number | null): boolean {
  return timestamp === null;
}

/**
 * Account deletion is a two-part operation: the RPC clears app data inside the
 * database, the Edge Function removes the auth user with the service role key.
 * The RPC is called first so a failure leaves a recoverable account.
 */
export async function deleteAccount(client: SupabaseClient): Promise<BlockResult> {
  const { error } = await client.rpc("delete_my_account");
  if (error) return { ok: false, message: error.message };

  const { error: functionError } = await client.functions.invoke("delete-account", { body: {} });
  if (functionError) {
    return {
      ok: false,
      message: "Данные удалены, но вход ещё активен. Напиши в поддержку, чтобы удалить аккаунт полностью.",
    };
  }
  await client.auth.signOut();
  return { ok: true };
}
