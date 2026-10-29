import { useEffect } from "react";
import { matchShortcut, type Shortcut } from "../lib/shortcuts";

type UseShortcutsOptions = {
  onShortcut: (shortcut: Shortcut) => void;
  /** Turned off while a dialog owns the keyboard. */
  enabled: boolean;
};

/**
 * Binds the global shortcuts.
 *
 * The handler is passed in rather than being closed over here, so the caller decides
 * what a shortcut means and this hook only decides what counts as a keystroke.
 */
export function useShortcuts({ onShortcut, enabled }: UseShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const matched = matchShortcut(event);
      if (!matched) return;
      // A matched shortcut is consumed: an unhandled ArrowUp must not also scroll the
      // message list while it marks a message for editing.
      event.preventDefault();
      onShortcut(matched);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onShortcut, enabled]);
}
