import { useEffect, useRef } from "react";
import { SHORTCUTS } from "../lib/shortcuts";

/** Renders a shortcut as the keys to press, so the list teaches by looking. */
function keys(shortcut: (typeof SHORTCUTS)[number]): string[] {
  const parts: string[] = [];
  if (shortcut.ctrlOrMeta) parts.push("Ctrl");
  if (shortcut.shift) parts.push("Shift");
  const named: Record<string, string> = {
    escape: "Esc",
    arrowup: "↑",
    arrowdown: "↓",
  };
  parts.push(named[shortcut.key] ?? shortcut.key.toUpperCase());
  return parts;
}

/**
 * The keyboard help sheet.
 *
 * Shortcuts nobody knows about are shortcuts nobody uses, so the list is reachable
 * with one keystroke and shows the keys as they are written on them.
 */
export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Focus moves into the dialog when it opens, stays inside while it is open, and goes
  // back where it was when it closes. Without this, Tab reached the buttons underneath.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", keepFocusInside);
      previous?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={panelRef}
        className="shortcut-help"
        role="dialog"
        aria-modal="true"
        aria-label="Горячие клавиши"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <strong>Горячие клавиши</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть" ref={closeRef}>
            ✕
          </button>
        </header>
        <ul>
          {SHORTCUTS.map((shortcut) => (
            <li key={`${shortcut.ctrlOrMeta ? "mod-" : ""}${shortcut.key}`}>
              <span className="shortcut-keys">
                {keys(shortcut).map((part) => (
                  <kbd key={part}>{part}</kbd>
                ))}
              </span>
              <span>{shortcut.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
