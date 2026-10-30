/**
 * Several accounts on one device.
 *
 * One person often has two: work and personal. Until now switching meant signing out and in
 * again, which loses the session of the first account and is slow enough that people give up.
 *
 * The design stands on one rule: **a session belongs to exactly one slot**. Supabase keeps its
 * session in a storage key, and two accounts cannot share it - the second sign-in overwrites the
 * first. Each saved account therefore gets its own key, and switching accounts means deciding
 * which key the client reads from. Nothing here holds a token itself: this module only decides
 * which slot is active and what each one is called.
 *
 * The honest limit, stated in the interface: sessions sit in this browser's storage. Anyone with
 * access to the device profile has the tokens that were saved, which is true of any saved login.
 * An account is therefore removable from this list in one press.
 */

export type SavedAccount = {
  /** Stable slot id; the storage key is derived from it. */
  slot: string;
  name: string;
  email: string | null;
  /** Avatar colour, so two accounts are told apart at a glance rather than by reading. */
  color: string;
  /** When this slot was last used, so the list can start from the most recent. */
  lastUsedAt: number;
};

export const ACCOUNTS_KEY = "nexus-saved-accounts";
export const ACTIVE_SLOT_KEY = "nexus-active-slot";

/** At most this many accounts; beyond a few the list stops being a shortcut. */
export const MAX_SAVED_ACCOUNTS = 4;

const COLORS = ["blue", "violet", "olive", "orange"] as const;

/**
 * The Supabase storage key for a slot.
 *
 * Derived from the slot rather than from the account id, because the key has to exist before
 * the first sign-in of that slot - at which point nobody knows the user id yet.
 */
export function storageKeyForSlot(slot: string): string {
  return `sb-nexus-auth-${slot}`;
}

/** The slot used by a build that has never seen the account switcher. */
export const DEFAULT_SLOT = "a";

/** A slot id that is free, or null when the list is full. */
export function nextFreeSlot(saved: SavedAccount[]): string | null {
  if (saved.length >= MAX_SAVED_ACCOUNTS) return null;
  const taken = new Set(saved.map((account) => account.slot));
  for (const candidate of ["a", "b", "c", "d"]) {
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

/** The colour for a new slot: the first that the existing accounts are not using. */
export function colorForSlot(saved: SavedAccount[]): string {
  const used = new Set(saved.map((account) => account.color));
  return COLORS.find((color) => !used.has(color)) ?? COLORS[saved.length % COLORS.length];
}

/** Adds or updates an account, keeping one entry per slot. */
export function upsertAccount(saved: SavedAccount[], account: SavedAccount): SavedAccount[] {
  const rest = saved.filter((item) => item.slot !== account.slot);
  return [...rest, account].sort((left, right) => right.lastUsedAt - left.lastUsedAt);
}

/** Removes one account; the active slot is handled by the caller, which knows where to go. */
export function removeAccount(saved: SavedAccount[], slot: string): SavedAccount[] {
  return saved.filter((account) => account.slot !== slot);
}

/** The account shown in the avatar menu, or undefined when nothing is saved yet. */
export function activeAccount(saved: SavedAccount[], activeSlot: string): SavedAccount | undefined {
  return saved.find((account) => account.slot === activeSlot);
}

/**
 * The slot to fall back to when the active one is removed.
 *
 * Some slot must remain active even with nothing saved, so the client still has a key to read
 * from: returning null here would leave the app with no session storage at all.
 */
export function fallbackSlot(saved: SavedAccount[], removed: string): { slot: string; empty: boolean } {
  const remaining = removeAccount(saved, removed);
  if (remaining.length > 0) return { slot: remaining[0].slot, empty: false };
  return { slot: DEFAULT_SLOT, empty: true };
}

/** "Рабочий" / "Личный" — a label a person chooses, kept short enough for a menu line. */
export function accountLabel(name: string, email: string | null): string {
  return email ? `${name} · ${email}` : name;
}

/** Whether adding another account should be offered at all. */
export function canAddAccount(saved: SavedAccount[]): boolean {
  return saved.length < MAX_SAVED_ACCOUNTS;
}
