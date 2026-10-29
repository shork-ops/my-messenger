import { useEffect } from "react";
import { isBackSwipe, type SwipePoint } from "../lib/gestures";

type UseBackSwipeOptions = {
  /** Only listen where a back gesture means something, such as an open chat. */
  enabled: boolean;
  onBack: () => void;
};

/**
 * Swipe from the left edge to go back.
 *
 * Bound to touch events rather than pointer events: on a phone the browser reclaims
 * pointer events for its own scrolling, and the gesture would sometimes be cancelled
 * halfway. Passive listeners are used so the gesture never blocks scrolling until it
 * is known to be a swipe.
 */
export function useBackSwipe({ enabled, onBack }: UseBackSwipeOptions) {
  useEffect(() => {
    if (!enabled) return;
    let start: SwipePoint | null = null;

    const touchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      start = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    };

    const touchEnd = (event: TouchEvent) => {
      const from = start;
      start = null;
      const touch = event.changedTouches[0];
      if (!from || !touch) return;
      // A gesture that began inside a field or a button belongs to it, not to us.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable='true']")) return;
      if (isBackSwipe(from, { x: touch.clientX, y: touch.clientY, t: Date.now() })) onBack();
    };

    window.addEventListener("touchstart", touchStart, { passive: true });
    window.addEventListener("touchend", touchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", touchStart);
      window.removeEventListener("touchend", touchEnd);
    };
  }, [enabled, onBack]);
}
