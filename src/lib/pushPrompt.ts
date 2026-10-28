/** Tracks whether the one-per-browser notification prompt has already been shown. */
const PERMISSION_PROMPT_KEY = "nexus:push-prompt";

export function pushPromptAlreadySeen(): boolean {
  try {
    return window.localStorage.getItem(PERMISSION_PROMPT_KEY) === "asked";
  } catch {
    return true;
  }
}

export function rememberPushPrompt(): void {
  try {
    window.localStorage.setItem(PERMISSION_PROMPT_KEY, "asked");
  } catch {
    // Storage can be disabled; the prompt then simply reappears next visit.
  }
}
