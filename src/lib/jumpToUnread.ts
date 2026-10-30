/**
 * The button that takes a reader somewhere they are not.
 *
 * Two situations look the same in a conversation and want different buttons: the reader is
 * scrolled up inside history, or the reader is at the end with unread messages further up
 * that they scrolled past. Deciding here rather than in the component keeps the component
 * to layout and makes the decision testable without a browser.
 */

export type JumpState = {
  /** Whether the message list is at its bottom, allowing a couple of pixels of slack. */
  atBottom: boolean;
  /** Whether the first unread message sits above the current view. */
  hasUnreadBelow: boolean;
  unreadCount: number;
};

export type JumpButton =
  | { kind: "unread"; count: number }
  | { kind: "end"; count: 0 };

export function jumpButton(state: JumpState): JumpButton | null {
  // At the bottom there is nowhere to go. A stale unread count must not produce a button
  // that scrolls zero pixels: that teaches people to ignore the button.
  if (state.atBottom) return null;
  // Unread messages win: they are a place with a reason, while the end is just the end.
  if (state.hasUnreadBelow) return { kind: "unread", count: state.unreadCount };
  return { kind: "end", count: 0 };
}

export type ScrollTargetInput = {
  /** Distance from the top of the scrollable content to the divider. */
  dividerTop: number;
  viewportHeight: number;
  contentHeight: number;
};

/**
 * Where to scroll so the divider lands a third of the way down.
 *
 * A third of context above the divider is what makes the first unread message legible: the
 * message before it is usually what it answers.
 */
export function scrollTarget({ dividerTop, viewportHeight, contentHeight }: ScrollTargetInput): number {
  const wanted = dividerTop - viewportHeight / 3;
  const max = Math.max(0, contentHeight - viewportHeight);
  return Math.min(Math.max(0, wanted), max);
}
