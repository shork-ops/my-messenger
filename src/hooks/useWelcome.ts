import { useCallback, useMemo, useState } from "react";
import { readItem, writeItem } from "../lib/safeStorage";

const WELCOME_KEY = "nexus-welcome-done-v1:";

/** Storage key that remembers the first-run card was answered for one account. */
export function welcomeKey(accountId: string): string {
  return WELCOME_KEY + accountId;
}

type UseWelcomeOptions = {
  accountId: string | null;
  profileReady: boolean;
  savedUsername: string;
};

/**
 * The first-run card: a name, an @username and an optional photo, asked once per account.
 *
 * It appears only for a signed-in account whose profile has loaded and that has never
 * chosen a username, and only until it is answered. "Later" is an answer too: the
 * same fields stay in Settings, so the card does not come back to nag. Demo mode has
 * no account, so it never appears there.
 */
export function useWelcome({ accountId, profileReady, savedUsername }: UseWelcomeOptions) {
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  const answeredBefore = useMemo(() => (accountId ? readItem(welcomeKey(accountId)) === "1" : false), [accountId]);
  const open = Boolean(profileReady && accountId && !savedUsername && !answeredBefore && answeredFor !== accountId);
  const finish = useCallback(() => {
    if (!accountId) return;
    writeItem(welcomeKey(accountId), "1");
    setAnsweredFor(accountId);
  }, [accountId]);
  return { open, finish };
}
