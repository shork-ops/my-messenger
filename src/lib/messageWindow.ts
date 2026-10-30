/**
 * Which messages to put in the DOM.
 *
 * A chat of five thousand messages put sixty thousand elements in the page and took two and a
 * half seconds to open - measured, not guessed. Only the messages near the viewport need to
 * exist; the rest can be space.
 *
 * The risk is the one this project has already hit three times: the scroll position. Every
 * function here obeys the same rule, and it is the reason the arithmetic is separate from the
 * component - **the window never changes the total height**. A message replaced by a spacer of
 * the same size cannot move anything.
 *
 * The messages are not a fixed height, so the space above the window is taken from the real
 * height of the rendered slice and scaled by how much is hidden. It is an estimate, but it is
 * an estimate that only affects where the scrollbar thumb sits, never where the reader is
 * looking.
 */

/** How many screens of messages to keep in the DOM on each side of the viewport. */
export const RENDER_WINDOW = 20;

/**
 * Below this many messages the whole conversation is rendered, as it always was.
 *
 * The window is a fix for a measured problem - sixty thousand elements and two and a half
 * seconds at five thousand messages - and applying it to a chat of forty messages would trade
 * a real risk for no gain.
 */
export const VIRTUALISE_THRESHOLD = 300;

/**
 * A first guess at one message's height, used only for the space standing in for messages
 * that are not rendered. The real height is measured from the slice once it is on screen.
 */
export const ESTIMATED_ITEM_HEIGHT = 72;

export type Window = { first: number; last: number };

type RangeInput = {
  scrollTop: number;
  viewportHeight: number;
  itemHeight: number;
  count: number;
};

/** The range of messages currently visible, in list indices. */
export function visibleRange({ scrollTop, viewportHeight, itemHeight, count }: RangeInput): Window {
  if (count <= 0) return { first: 0, last: 0 };
  if (itemHeight <= 0) return { first: 0, last: count };
  // A browser reports a negative scrollTop while the page is being pulled past its top, so
  // the value is clamped rather than trusted.
  const top = Math.max(0, scrollTop);
  const first = Math.max(0, Math.floor(top / itemHeight));
  const last = Math.min(count, Math.ceil((top + viewportHeight) / itemHeight));
  return { first, last };
}

/** A visible range widened by the window margin, clamped to the list. */
export function windowAround(visible: Window, count: number): Window {
  return {
    first: Math.max(0, visible.first - RENDER_WINDOW),
    last: Math.min(count, visible.last + RENDER_WINDOW),
  };
}

/**
 * The window a conversation opens with: the end, plus a margin.
 *
 * A conversation is read from its last message backwards, so this is also the window that
 * makes opening a long chat cheap - the reader sees the bottom immediately.
 */
export function initialWindow(count: number): Window {
  if (count <= 0) return { first: 0, last: 0 };
  return { first: Math.max(0, count - RENDER_WINDOW * 2), last: count };
}

/**
 * The window after a scroll, given the window already rendered.
 *
 * It follows the viewport with a margin on each side. Growing only would be wrong: jumping to
 * the top of a long conversation would leave every message rendered, which is the very state
 * this is meant to avoid - measured at five thousand messages, the whole list came back.
 *
 * The reason it does not simply recentre on every scroll is flapping: a window that changes on
 * every pixel re-renders the whole list each time. So it only moves when the viewport has left
 * the margin, in which case it recentres with the full margin on both sides.
 */
export function nearbyWindow(current: Window, visible: Window, count: number, margin = RENDER_WINDOW): Window {
  const inside =
    visible.first >= current.first + Math.floor(margin / 2) && visible.last <= current.last - Math.floor(margin / 2);
  const target = inside
    ? current
    : { first: Math.max(0, visible.first - margin), last: Math.min(count, visible.last + margin) };
  if (target.first === current.first && target.last === current.last) return current;
  return target;
}

/**
 * The height of the space standing in for messages above the window.
 *
 * `renderedHeight` is the measured height of the messages actually in the DOM, and
 * `renderedCount` is how many of them it covers. Scaling the average keeps the space
 * roughly right without pretending every message is the same height.
 */
export function spaceBefore(first: number, renderedHeight: number, renderedCount: number): number {
  if (first <= 0 || renderedCount <= 0 || renderedHeight <= 0) return 0;
  return Math.round((renderedHeight / renderedCount) * first);
}

/** The same for the space below the window. */
export function spaceAfter(count: number, last: number, renderedHeight: number, renderedCount: number): number {
  if (last >= count || renderedCount <= 0 || renderedHeight <= 0) return 0;
  return Math.round((renderedHeight / renderedCount) * (count - last));
}
