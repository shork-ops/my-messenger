import { useCallback, useEffect } from "react";
import { scopedKey } from "../lib/accountScope";
import { useOwnerStorage } from "../lib/useOwnerStorage";
import { DEFAULT_PRIVACY, parsePrivacy, serializePrivacy, type PrivacyPrefs } from "../lib/privacyPrefs";

const STORAGE_KEY = "nexus-privacy-prefs";

/**
 * Privacy preferences, stored per browser and per account.
 *
 * Per browser for the same reason notification settings are: they describe what this device
 * shows, and a laptop used at work should not have the same answer as a phone kept at home.
 * Per account for the reason that matters more here: these switches decide *whose* read receipts
 * and last-seen are drawn, so one account's choice must not be applied in another account's
 * session on a shared machine.
 *
 * The honest limit is that the other side's app still receives its own read events; this switch
 * decides what is drawn, not what is sent.
 */
export function usePrivacyPrefs(accountId: string | null) {
  const { value: prefs, setValue: setPrefsState, store } = useOwnerStorage<PrivacyPrefs>({
    accountId,
    key: STORAGE_KEY,
    read: (raw) => parsePrivacy(raw ?? serializePrivacy(DEFAULT_PRIVACY)),
    write: serializePrivacy,
  });

  // Cross-tab: two windows of the same account should agree about what they show.
  useEffect(() => {
    const fullKey = scopedKey(store.owner, STORAGE_KEY);
    const onStorage = (event: StorageEvent) => {
      if (event.key === fullKey) setPrefsState(parsePrivacy(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [store, setPrefsState]);

  const setPrefs = useCallback((next: PrivacyPrefs) => setPrefsState(next), [setPrefsState]);

  return { prefs, setPrefs };
}
