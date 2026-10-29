/**
 * A swipe back from the left edge.
 *
 * Written as plain arithmetic rather than bound to touch events, so the thresholds
 * can be tested without a phone. A swipe that fires on a slightly uneven tap would
 * throw people out of a conversation, so the thresholds are deliberately strict.
 */

/** How far from the left edge a gesture must start. */
export const EDGE_ZONE_PX = 32;

/** How far right it must travel before it counts. */
export const MIN_SWIPE_PX = 64;

/** More vertical than this and it was a scroll, not a swipe. */
export const MAX_VERTICAL_DRIFT_PX = 48;

/** Longer than this and the finger was resting, not swiping. */
export const MAX_SWIPE_MS = 700;

export type SwipePoint = { x: number; y: number; t: number };

/**
 * Whether a gesture is a swipe back.
 *
 * All four conditions must hold: it starts at the edge, travels right, stays
 * roughly horizontal, and finishes promptly. Each one rules out a different thing a
 * person's finger does by accident — a tap in the middle, a vertical scroll, a slow
 * drag while reading.
 */
export function isBackSwipe(start: SwipePoint, end: SwipePoint): boolean {
  const dx = end.x - start.x;
  const dy = Math.abs(end.y - start.y);
  const elapsed = end.t - start.t;
  if (start.x > EDGE_ZONE_PX) return false;
  if (dx < MIN_SWIPE_PX) return false;
  if (dy > MAX_VERTICAL_DRIFT_PX) return false;
  if (elapsed < 0 || elapsed > MAX_SWIPE_MS) return false;
  return true;
}

/**
 * How far the conversation has slid, for showing the movement as it happens.
 *
 * Capped at the width of the screen: the page cannot move further than that, and an
 * uncapped value would keep the visual lagging behind the finger.
 */
export function swipeOffset(start: SwipePoint, end: SwipePoint, width: number): number {
  const dx = end.x - start.x;
  if (dx <= 0) return 0;
  return Math.min(width, dx);
}
