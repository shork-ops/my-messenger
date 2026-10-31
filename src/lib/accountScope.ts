/**
 * Whose data is in this browser.
 *
 * Every cache the app keeps on the device — the chat list, drafts, the reply target, folders,
 * the durable outbox, notification and privacy preferences, wallpaper, game saves, notification
 * subscriptions, the passcode — describes one account. Kept under one shared key, that data is
 * readable by whoever signs in next on the same browser: a switch from A to B would show B the
 * conversation A was writing, and a draft written as A could be sent by B.
 *
 * This module is the single place that answers *whose* storage a key belongs to, so the answer is
 * not re-derived (and re-derived wrongly) in twenty hooks. The rules:
 *
 * 1. **The owner is the real auth user id.** Not an email, not a display name, not the account
 *    slot index: only `user.id` from Supabase identifies a person, and two people can share both
 *    a name and a mailbox-shaped label.
 * 2. **A guest is not "no account".** Someone using the app before signing in is its own owner
 *    with its own namespace, so demo data never mixes with a real account's data, and a real
 *    account's data never leaks into the guest view.
 * 3. **Migration needs a proven owner.** A key written by an older build has no owner in it. It
 *    is adopted only when there is exactly one account that could own it *and* the data itself
 *    names that account; otherwise it is left in place, unread, and reported rather than guessed.
 *    Attributing an unknown cache to the first person who signs in is precisely the leak this
 *    file exists to prevent, so it is refused by construction.
 *
 * The namespace rule is a single prefix, so "does this key belong to me" is decidable for every
 * key the app writes, including keys written by code that has not been updated yet.
 */

/** The account whose data this browser session is allowed to read and write. */
export type StorageOwner = {
  /**
   * The key namespace for this owner.
   *
   * `u:<uuid>` for a signed-in account, `guest` before anyone signs in. Derived, never supplied
   * by a caller that could get it wrong.
   */
  scope: string;
  /** The real auth user id, or null in guest mode. */
  accountId: string | null;
};

/** Prefix of every account-scoped key this app writes. */
export const SCOPE_PREFIX = "nexus-scoped:";

/** The guest namespace: one browser that has not signed in, kept apart from every account. */
export const GUEST_SCOPE = "guest";

/**
 * The owner for an auth user id.
 *
 * The uuid is lowercased because Postgres renders it in either case depending on where it came
 * from, and two spellings of one id would otherwise produce two namespaces for one person.
 */
export function ownerFor(accountId: string | null | undefined): StorageOwner {
  const trimmed = typeof accountId === "string" ? accountId.trim().toLowerCase() : "";
  if (!trimmed) return { scope: GUEST_SCOPE, accountId: null };
  return { scope: `u:${trimmed}`, accountId: trimmed };
}

/** The full storage key for one logical key and one owner. */
export function scopedKey(owner: StorageOwner, key: string): string {
  return `${SCOPE_PREFIX}${owner.scope}:${key}`;
}

/** Whether a storage key belongs to this owner; false for another account's and for legacy keys. */
export function keyBelongsTo(key: string, owner: StorageOwner): boolean {
  return key.startsWith(`${SCOPE_PREFIX}${owner.scope}:`);
}

/**
 * The namespace a legacy (unscoped) key would have been written under, if any.
 *
 * Only used to *describe* what is found; nothing is adopted on the strength of it.
 */
export function legacyKeyFor(key: string): string {
  return key;
}

/** A legacy cache found on the device, and what the app did with it. */
export type LegacyCacheReport = {
  /** The old, unscoped key. */
  key: string;
  /** Whether it was adopted into an account, left alone, or removed as unusable. */
  decision: "adopted" | "left" | "discarded";
  /** Why, in a sentence a person could read in a log or a settings screen. */
  reason: string;
};

/**
 * Decides whether one legacy cache can be adopted by one account.
 *
 * The rule is deliberately strict. Data written before scoping carries no owner, so adopting it
 * requires evidence *inside the data*: an array of records whose `senderId`/`userId`/`accountId`
 * field names this account, or an object with such a field. Anything else — including data that
 * merely looks plausible, and data with no owner field at all — is left where it is.
 *
 * `null` means "not mine, do not touch"; `{ adopt: true }` means the caller may move it.
 */
export function mayAdoptLegacy(
  parsed: unknown,
  accountId: string | null
): { adopt: true } | { adopt: false; reason: string } {
  if (!accountId) {
    // A guest has no uuid, and no legacy cache can prove a guest owns it.
    return { adopt: false, reason: "Гостевой режим не наследует старый кэш без владельца" };
  }

  const owner = accountId.trim().toLowerCase();
  const matches = (value: unknown): boolean =>
    typeof value === "string" && value.trim().toLowerCase() === owner;

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { adopt: false, reason: "Старый кэш пуст" };
    let named = 0;
    let foreign = 0;
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        foreign += 1;
        continue;
      }
      const record = entry as Record<string, unknown>;
      const candidate = record.senderId ?? record.userId ?? record.accountId ?? record.ownerId;
      if (matches(candidate)) named += 1;
      else foreign += 1;
    }
    if (named > 0 && foreign === 0) return { adopt: true };
    if (named > 0) return { adopt: false, reason: "В старом кэше есть чужие записи" };
    return { adopt: false, reason: "Старый кэш не называет владельца" };
  }

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const candidate = record.senderId ?? record.userId ?? record.accountId ?? record.ownerId;
    if (matches(candidate)) return { adopt: true };
    return { adopt: false, reason: "Старый кэш не называет владельца" };
  }

  return { adopt: false, reason: "Старый кэш не удалось прочитать" };
}

/** Whether a value is worth writing at all, so an empty cache is not left lying around. */
export function isEmptyForStorage(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}
