/**
 * Keyboard shortcuts.
 *
 * A shortcut that fires while someone is typing is worse than no shortcut: pressing
 * Escape to close a mention list must not also close the chat. The typing check is
 * therefore part of the matcher rather than something each handler remembers.
 */

export type Shortcut = {
  /** Lower-case key name, as in `KeyboardEvent.key`. */
  key: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  /** What it does, for the help list. */
  label: string;
};

export const SHORTCUTS: Shortcut[] = [
  { key: "escape", label: "Закрыть окно или отменить действие" },
  { key: "k", ctrlOrMeta: true, label: "Поиск по чатам" },
  { key: "f", ctrlOrMeta: true, label: "Поиск по переписке" },
  { key: "arrowup", label: "Редактировать последнее сообщение" },
  { key: "arrowdown", label: "Выйти из редактирования" },
  { key: "n", ctrlOrMeta: true, label: "Новый чат" },
  { key: "?", shift: true, label: "Список горячих клавиш" },
];

/** Elements whose keystrokes belong to the person typing, not to the app. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return element.isContentEditable === true;
}

/**
 * The shortcut a keystroke matches, or null.
 *
 * Escape is the exception among the typing rules: it is how a person gets out of a
 * field, so it is allowed through while typing and left to the focused element to
 * decide what closing means.
 */
export function matchShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}): Shortcut | null {
  const key = event.key.toLowerCase();
  const typing = isTypingTarget(event.target ?? null);

  const found = SHORTCUTS.find((shortcut) => {
    if (shortcut.key !== key) return false;
    const wantsModifier = Boolean(shortcut.ctrlOrMeta);
    const hasModifier = Boolean(event.ctrlKey || event.metaKey);
    if (wantsModifier !== hasModifier) return false;
    if (Boolean(shortcut.shift) !== Boolean(event.shiftKey)) return false;
    return true;
  });

  if (!found) return null;
  if (typing && found.key !== "escape") return null;
  return found;
}
