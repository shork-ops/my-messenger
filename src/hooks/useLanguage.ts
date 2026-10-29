import { useCallback, useEffect, useState } from "react";
import { LANGUAGE_STORAGE_KEY, type Language, parseLanguage, translate } from "../lib/i18n";

/**
 * The chosen language, remembered on this device.
 *
 * The choice is a device preference, not an account one, in the same way the
 * theme is: a phone set to English should not change the laptop.
 */
export function useLanguage() {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === "undefined") return parseLanguage(null);
    try {
      return parseLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
    } catch {
      return parseLanguage(null);
    }
  });

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice holds for this session only.
    }
    document.documentElement.lang = next;
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Another tab changing the language should not leave this one behind.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      setLanguageState(parseLanguage(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /** A translator bound to the current language. */
  const t = useCallback(
    (key: string, ru?: Record<string, string>) => translate(language, key, ru),
    [language]
  );

  return { language, setLanguage, t };
}
