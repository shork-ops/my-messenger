import { useCallback, useState } from "react";
import { PASSCODE_STORAGE_KEY } from "../lib/sessions";

/**
 * A four-digit lock, remembered on this device.
 *
 * It is a lock on the app, not encryption: the data stays in the cloud behind the
 * account password. Saying so matters - someone who believes a four-digit code
 * protects their messages may rely on it far more than it can bear.
 */
export function usePasscode() {
  const [passcode, setPasscodeState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem(PASSCODE_STORAGE_KEY);
      return stored && /^\d{4}$/.test(stored) ? stored : null;
    } catch {
      return null;
    }
  });
  // A fresh load with a code present starts locked; the same tab setting a code
  // must not lock itself mid-conversation.
  const [unlocked, setUnlocked] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = window.localStorage.getItem(PASSCODE_STORAGE_KEY);
      return !(stored && /^\d{4}$/.test(stored));
    } catch {
      return true;
    }
  });

  const setCode = useCallback((code: string | null) => {
    setPasscodeState(code);
    try {
      if (code) window.localStorage.setItem(PASSCODE_STORAGE_KEY, code);
      else window.localStorage.removeItem(PASSCODE_STORAGE_KEY);
    } catch {
      // Storage blocked: the code holds for this session only.
    }
    // Setting a code means you are already in; removing one must not lock you out.
    setUnlocked(true);
  }, []);

  const unlock = useCallback(() => setUnlocked(true), []);

  return { passcode, unlocked, setCode, unlock };
}
