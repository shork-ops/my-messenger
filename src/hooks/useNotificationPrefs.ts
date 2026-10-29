import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  parsePrefs,
  serializePrefs,
} from "../lib/notificationPrefs";

const STORAGE_KEY = "nexus-notification-prefs";

/**
 * Notification preferences, stored per browser.
 *
 * Not on the server: sound and vibration are properties of this device, and a
 * phone that is silent should not silence the laptop as well.
 */
export function useNotificationPrefs() {
  const [prefs, setPrefsState] = useState<NotificationPrefs>(() => {
    try {
      return parsePrefs(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return DEFAULT_NOTIFICATION_PREFS;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, serializePrefs(prefs));
    } catch {
      // Private mode without storage: the preferences last for this session.
    }
  }, [prefs]);

  // Cross-tab: two windows of the same account should agree.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setPrefsState(parsePrefs(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPrefs = useCallback((next: NotificationPrefs) => setPrefsState(next), []);

  return { prefs, setPrefs };
}
