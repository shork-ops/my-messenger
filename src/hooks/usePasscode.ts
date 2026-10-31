import { useCallback, useMemo, useState } from "react";
import { PASSCODE_STORAGE_KEY, isValidPasscode } from "../lib/sessions";
import { useOwnerStorage } from "../lib/useOwnerStorage";

/**
 * A four-digit lock, remembered on this device for this account.
 *
 * It is a lock on the app, not encryption: the data stays in the cloud behind the account
 * password. Saying so matters - someone who believes a four-digit code protects their messages
 * may rely on it far more than it can bear.
 *
 * Stored per account: the code protects *an account's* conversations, and on a shared browser a
 * code set by one person must not follow them into the other person's session - nor must signing
 * into another account silently skip the lock that was set for it.
 *
 * Unlock state is deliberately not persisted. A reload locks again, and so does switching back to
 * an account whose code was set, which is what a lock is for.
 */
export function usePasscode(accountId: string | null) {
  const { value: stored, setValue: setStored, owner } = useOwnerStorage<string>({
    accountId,
    key: PASSCODE_STORAGE_KEY,
    read: (raw) => (raw && isValidPasscode(raw) ? raw : ""),
    write: (value) => (value && isValidPasscode(value) ? value : null),
  });
  const passcode = stored && isValidPasscode(stored) ? stored : null;

  // Which account the current "unlocked" flag belongs to. A code present at load starts locked.
  const [unlockState, setUnlockState] = useState<{ scope: string; unlocked: boolean }>(() => ({
    scope: owner.scope,
    unlocked: passcode === null,
  }));

  let unlocked = unlockState.unlocked;
  if (unlockState.scope !== owner.scope) {
    // The account changed: the new account's lock state applies, not the previous one's.
    unlocked = passcode === null;
    setUnlockState({ scope: owner.scope, unlocked });
  }

  const setCode = useCallback(
    (code: string | null) => {
      setStored(code ?? "");
      // Setting a code means you are already in; removing one must not lock you out.
      setUnlockState({ scope: owner.scope, unlocked: true });
    },
    [setStored, owner.scope]
  );

  const unlock = useCallback(() => setUnlockState({ scope: owner.scope, unlocked: true }), [owner.scope]);

  // Memoised so a consumer that depends on the returned object does not re-subscribe every render.
  return useMemo(
    () => ({ passcode, unlocked, setCode, unlock }),
    [passcode, unlocked, setCode, unlock]
  );
}
