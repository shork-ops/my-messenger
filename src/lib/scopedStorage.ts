/**
 * Storage that knows whose data it is.
 *
 * A thin layer over `safeStorage` that prefixes every key with the owner's namespace from
 * `accountScope`. Two properties matter and are the reason this is a module rather than a helper
 * function:
 *
 * - **A hook cannot accidentally write to the shared namespace.** There is no "unscoped" write
 *   here, so the only way to store something is to say whose it is.
 * - **Switching accounts is a key change, not a copy.** B's namespace was never written by A, so
 *   nothing has to be cleared for A's data to stop being visible; it is simply not addressable
 *   from B's scope.
 *
 * A reader that has not received the account id yet gets the guest namespace, never an empty
 * string and never "whatever was there before". The worst case is showing guest placeholder data
 * for a moment, which is not someone else's.
 */

import { readItem, removeItem, writeItem } from "./safeStorage";
import { isEmptyForStorage, keyBelongsTo, ownerFor, scopedKey, SCOPE_PREFIX, type StorageOwner } from "./accountScope";

/** One owner's view of local storage. */
export type ScopedStore = {
  owner: StorageOwner;
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  remove: (key: string) => void;
  /** Removes every key this owner owns, and nothing else. */
  clear: () => number;
  /** Whether this owner has anything stored. */
  hasAny: () => boolean;
  /** The keys this owner owns, without the namespace prefix. */
  keys: () => string[];
};

/** Every key currently in local storage, or none when storage is unavailable. */
function allKeys(): string[] {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

/** The logical key without this owner's prefix. */
function stripScope(key: string, prefix: string): string {
  return key.slice(prefix.length);
}

export function scopedStore(accountId: string | null | undefined): ScopedStore {
  const owner = ownerFor(accountId);
  const prefix = `${SCOPE_PREFIX}${owner.scope}:`;

  return {
    owner,
    read(key) {
      return readItem(scopedKey(owner, key));
    },
    write(key, value) {
      // An empty cache is removed rather than stored as "{}": a leftover empty object is
      // indistinguishable from real data on the next read and makes "has this account ever been
      // used" unanswerable.
      let parsed: unknown;
      let isEmpty = false;
      try {
        parsed = JSON.parse(value);
        isEmpty = isEmptyForStorage(parsed);
      } catch {
        // Not JSON; a plain string is never "empty" in the storage sense.
      }
      if (isEmpty) removeItem(scopedKey(owner, key));
      else writeItem(scopedKey(owner, key), value);
    },
    remove(key) {
      removeItem(scopedKey(owner, key));
    },
    clear() {
      let removed = 0;
      for (const key of allKeys()) {
        if (!keyBelongsTo(key, owner)) continue;
        removeItem(key);
        removed += 1;
      }
      return removed;
    },
    hasAny() {
      return allKeys().some((key) => keyBelongsTo(key, owner));
    },
    keys() {
      return allKeys()
        .filter((key) => keyBelongsTo(key, owner))
        .map((key) => stripScope(key, prefix));
    },
  };
}

/**
 * The owner currently in effect for a component tree.
 *
 * Derived from the same auth user id the app uses everywhere else. Kept as a function rather than
 * a value so it is always read *now*: a stale captured owner is how data leaks between accounts
 * that swapped places while a request was in flight.
 */
export function currentOwner(accountId: string | null | undefined): StorageOwner {
  return ownerFor(accountId);
}
