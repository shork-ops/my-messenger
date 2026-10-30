import { useCallback, useEffect, useState } from "react";
import {
  ACTIVE_SLOT_KEY,
  ACCOUNTS_KEY,
  DEFAULT_SLOT,
  activeAccount,
  colorForSlot,
  fallbackSlot,
  nextFreeSlot,
  removeAccount,
  storageKeyForSlot,
  upsertAccount,
  type SavedAccount,
} from "../lib/accounts";

/**
 * The saved accounts, and which one is in use.
 *
 * The list and the chosen slot live in `localStorage` because they describe the device, not the
 * account: it is this browser that holds several logins.
 *
 * Switching is done by writing the chosen slot and reloading the page. That is deliberate rather
 * than lazy. The Supabase client reads its storage key once, when it is created, and the whole
 * app holds state - subscriptions, cached chats, an open conversation - that belongs to the
 * account that was in use. Recreating all of that by hand is a much larger change with many more
 * places to get wrong; a reload is instant for a page of this size and cannot leak one account's
 * data into the other's screen.
 */
export function useAccounts() {
  const [saved, setSaved] = useState<SavedAccount[]>([]);
  const [activeSlot, setActiveSlot] = useState<string>(DEFAULT_SLOT);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      setReady(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(ACCOUNTS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setSaved(
          parsed.filter(
            (item): item is SavedAccount =>
              Boolean(item) && typeof item === "object" && typeof (item as SavedAccount).slot === "string"
          )
        );
      }
      setActiveSlot(window.localStorage.getItem(ACTIVE_SLOT_KEY) || DEFAULT_SLOT);
    } catch {
      // Unreadable storage is not a reason to fail to start; it is a reason to start empty.
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: SavedAccount[]) => {
    setSaved(next);
    try {
      window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(next));
    } catch {
      // Everything still works for this visit; the list just will not be remembered.
    }
  }, []);

  /**
   * Records the account that is signed in.
   *
   * Called after a successful sign-in: the slot was chosen before the session existed, and now
   * the name and email are known, so the entry is filled in.
   */
  const remember = useCallback(
    (profile: { name: string; email: string | null }) => {
      const slot = activeSlot;
      const existing = saved.find((account) => account.slot === slot);
      persist(
        upsertAccount(saved, {
          slot,
          name: profile.name,
          email: profile.email,
          color: existing?.color ?? colorForSlot(saved),
          lastUsedAt: Date.now(),
        })
      );
    },
    [activeSlot, persist, saved]
  );

  /** Switches to another saved account by reloading into its storage key. */
  const switchTo = useCallback((slot: string) => {
    setSwitching(true);
    try {
      window.localStorage.setItem(ACTIVE_SLOT_KEY, slot);
    } catch {
      setSwitching(false);
      return;
    }
    // A reload is what makes the other account's session the one the client reads.
    window.location.reload();
  }, []);

  /**
   * Prepares an empty slot for "add another account".
   *
   * The current session is left untouched: signing out would destroy it, and the person who
   * adds a second account expects the first to still be there afterwards.
   */
  const startNew = useCallback((): boolean => {
    const slot = nextFreeSlot(saved);
    if (!slot) return false;
    setSwitching(true);
    try {
      window.localStorage.setItem(ACTIVE_SLOT_KEY, slot);
    } catch {
      setSwitching(false);
      return false;
    }
    window.location.reload();
    return true;
  }, [saved]);

  /** Forgets a saved account, including the tokens stored under its key. */
  const forget = useCallback(
    (slot: string) => {
      const next = removeAccount(saved, slot);
      persist(next);
      try {
        // The session itself goes too: removing the entry but leaving the token would be a
        // "signed out" account that is still signed in.
        window.localStorage.removeItem(storageKeyForSlot(slot));
      } catch {
        // Nothing to do; the list entry is gone either way.
      }
      if (slot === activeSlot) {
        const outcome = fallbackSlot(saved, slot);
        setSwitching(true);
        try {
          window.localStorage.setItem(ACTIVE_SLOT_KEY, outcome.slot);
        } catch {
          setSwitching(false);
        }
        window.location.reload();
      }
    },
    [activeSlot, persist, saved]
  );

  return {
    saved,
    activeSlot,
    active: activeAccount(saved, activeSlot),
    ready,
    switching,
    remember,
    switchTo,
    startNew,
    forget,
  };
}
