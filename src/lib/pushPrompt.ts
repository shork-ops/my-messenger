/**
 * Tracks whether the one-per-browser-and-account notification prompt has already been shown.
 *
 * Scoped by account because it is a question about a person, not only about the device: the
 * answer decides whether *this* reader sees the prompt, and a shared laptop must not silence or
 * replay it based on the previous account's choice.
 */

import { scopedStore } from "./scopedStorage";

const PERMISSION_PROMPT_KEY = "nexus:push-prompt";

export function pushPromptAlreadySeen(accountId: string | null): boolean {
  try {
    return scopedStore(accountId).read(PERMISSION_PROMPT_KEY) === "asked";
  } catch {
    // If storage is unreadable the safe answer is "already asked": showing a prompt that cannot
    // be answered again is worse than not showing it.
    return true;
  }
}

export function rememberPushPrompt(accountId: string | null): void {
  try {
    scopedStore(accountId).write(PERMISSION_PROMPT_KEY, "asked");
  } catch {
    // Storage can be disabled; the prompt then simply reappears next visit.
  }
}
