/**
 * State that belongs to one account.
 *
 * Every cache in the app needs the same three things, and getting any of them subtly wrong is how
 * a shared browser leaks one person's data into another's session:
 *
 * 1. **Read on mount** from the owner's namespace.
 * 2. **Write on change** to the *same* owner's namespace — never "the current account's", because
 *    the current account can change between the change and the write.
 * 3. **Re-read when the owner changes**, before anything from the previous owner is shown.
 *
 * Point 3 is the one that is easy to get wrong. Writing it as a `useEffect` that resets state does
 * not work: effects run in declaration order, so a write-back effect declared first persists the
 * *old* value under the *new* owner's key, and the reset then reads its own mistake back. The
 * symptom is an account switch that appears to do nothing.
 *
 * The fix is to key the state by owner: when the owner differs from the one the current value was
 * loaded for, the value is re-derived during render, so no render ever shows one account's data in
 * another account's session. React's documented pattern for "state that resets when a prop
 * changes" is exactly this, and it is used here rather than a key on the component because these
 * hooks sit at the top of the app and cannot be re-mounted without losing everything else.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { scopedStore, type ScopedStore } from "./scopedStorage";
import type { StorageOwner } from "./accountScope";

export type OwnerBoundValue<T> = {
  value: T;
  setValue: (next: T | ((current: T) => T)) => void;
  store: ScopedStore;
  owner: StorageOwner;
};

/**
 * A value stored in one owner's namespace.
 *
 * `read` parses what is in storage; `write` serialises it. Both are supplied by the caller because
 * different caches store different shapes, and keeping the parsing next to its type is what stops
 * a chess position being read as a folder list.
 */
export function useOwnerStorage<T>(options: {
  accountId: string | null;
  key: string;
  read: (raw: string | null) => T;
  /** Serialises, or returns null to mean "store nothing" (an empty cache). */
  write: (value: T) => string | null;
}): OwnerBoundValue<T> {
  const { accountId, key, read, write } = options;
  const store = useMemo(() => scopedStore(accountId), [accountId]);
  const ownerScope = store.owner.scope;

  // Which owner the value in state belongs to. Kept beside the value, so the two can never
  // disagree about whose data is on screen.
  const [state, setState] = useState<{ scope: string; value: T }>(() => ({
    scope: ownerScope,
    value: read(store.read(key)),
  }));

  // A different owner during render: re-derive immediately rather than after paint.
  let current = state;
  if (state.scope !== ownerScope) {
    current = { scope: ownerScope, value: read(store.read(key)) };
    setState(current);
  }

  // The store the write must go to is the one the *value* was loaded from, not whichever is
  // current now. A pending write from a switched-away account therefore lands in its own
  // namespace instead of overwriting the account that replaced it.
  const storeForScope = useRef<{ scope: string; store: ScopedStore }>({ scope: ownerScope, store });
  if (storeForScope.current.scope !== ownerScope) storeForScope.current = { scope: ownerScope, store };

  const setValue = useCallback(
    (next: T | ((value: T) => T)) => {
      setState((previous) => {
        const value = typeof next === "function" ? (next as (value: T) => T)(previous.value) : next;
        const target = storeForScope.current.scope === previous.scope ? storeForScope.current.store : store;
        const serialised = write(value);
        if (serialised === null) target.remove(key);
        else target.write(key, serialised);
        return { scope: previous.scope, value };
      });
    },
    [key, store, write]
  );

  return { value: current.value, setValue, store, owner: store.owner };
}

/** The same, for a value whose reader and writer are the identity. */
export function useOwnerString(accountId: string | null, key: string, fallback = ""): OwnerBoundValue<string> {
  return useOwnerStorage<string>({
    accountId,
    key,
    read: (raw) => raw ?? fallback,
    write: (value) => (value === fallback ? null : value),
  });
}
