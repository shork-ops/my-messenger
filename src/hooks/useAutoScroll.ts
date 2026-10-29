import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/**
 * Keeps the newest message in view.
 *
 * `holdUntil` lets the caller mark the state - such as a chat that opened on its
 * first unread message - where jumping to the bottom would undo something more
 * useful than it achieves.
 */
export function useAutoScroll(
  ref: MutableRefObject<HTMLElement | null>,
  dependencies: unknown[],
  holdUntil?: number | null
) {
  const holdRef = useRef<number | null>(null);
  holdRef.current = holdUntil ?? null;

  useEffect(() => {
    // A chat that opened at the unread divider stays there: scrolling to the
    // bottom would throw away the one piece of information the reader came for.
    if (holdRef.current !== null) return;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, holdUntil]);
}
