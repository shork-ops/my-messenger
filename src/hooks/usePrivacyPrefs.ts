import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PRIVACY, parsePrivacy, serializePrivacy, type PrivacyPrefs } from "../lib/privacyPrefs";

const STORAGE_KEY = "nexus-privacy-prefs";

/**
 * Privacy preferences, stored per browser.
 *
 * Per browser for the same reason notification settings are: they describe what this device
 * shows, and a laptop used at work should not have the same answer as a phone kept at home.
 * The honest limit is that the other side's app still receives its own read events; this
 * switch decides what is drawn, not what is sent.
 */
export function usePrivacyPrefs() {
  const [prefs, setPrefsState] = useState<PrivacyPrefs>(() => {
    try {
      return parsePrivacy(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return DEFAULT_PRIVACY;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, serializePrivacy(prefs));
    } catch {
      // Private mode without storage: the preferences last for this session.
    }
  }, [prefs]);

  // Cross-tab: two windows of the same account should agree about what they show.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setPrefsState(parsePrivacy(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPrefs = useCallback((next: PrivacyPrefs) => setPrefsState(next), []);

  return { prefs, setPrefs };
}
