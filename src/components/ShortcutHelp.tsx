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
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="shortcut-help" aria-label="Горячие клавиши" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>Горячие клавиши</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
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
