import { useCallback, useEffect } from "react";
import { scopedKey } from "../lib/accountScope";
import { useOwnerStorage } from "../lib/useOwnerStorage";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  parsePrefs,
  serializePrefs,
} from "../lib/notificationPrefs";

const STORAGE_KEY = "nexus-notification-prefs";

/**
 * Notification preferences, stored per browser *and per account*.
 *
 * Not on the server: sound and vibration are properties of this device, and a phone that is
 * silent should not silence the laptop as well.
 *
 * Per account as well as per device, because two people sharing a laptop are two different
 * readers: one turning sound off must not mute the other, and a preference written in one
 * account is not the next account's to inherit.
 */
export function useNotificationPrefs(accountId: string | null) {
  const { value: prefs, setValue: setPrefsState, store } = useOwnerStorage<NotificationPrefs>({
    accountId,
    key: STORAGE_KEY,
    read: (raw) => parsePrefs(raw ?? serializePrefs(DEFAULT_NOTIFICATION_PREFS)),
    write: serializePrefs,
  });

  // Cross-tab: two windows of the same account should agree. The event carries the full key, so
  // a change made by a different account in another tab is ignored rather than applied here.
  useEffect(() => {
    const fullKey = scopedKey(store.owner, STORAGE_KEY);
    const onStorage = (event: StorageEvent) => {
      if (event.key === fullKey) setPrefsState(parsePrefs(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [store, setPrefsState]);

  const setPrefs = useCallback((next: NotificationPrefs) => setPrefsState(next), [setPrefsState]);

  return { prefs, setPrefs };
}
