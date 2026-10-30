import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/**
 * Keeps the newest message in view.
 *
 * `holdUntil` lets the caller mark the state - such as a chat that opened on its
 * first unread message - where jumping to the bottom would undo something more
 * useful than it achieves.
 *
 * A conversation is opened to read what was said last, so the first jump is
 * instantaneous. A smooth scroll does not finish reliably on a phone: it is
 * cancelled when the list grows underneath it, and it leaves the reader partway
 * up a conversation they have just opened - which reads as "it opens from the
 * beginning, and I have to scroll down to the new messages".
 */
export function useAutoScroll(
  ref: MutableRefObject<HTMLElement | null>,
  dependencies: unknown[],
  holdUntil?: number | null
) {
  const holdRef = useRef<number | null>(null);
  holdRef.current = holdUntil ?? null;
  // The first jump after a chat appears is a landing, not a scroll someone asked for.
  const landedRef = useRef(false);

  useEffect(() => {
    // A chat that opened at the unread divider stays there: scrolling to the
    // bottom would throw away the one piece of information the reader came for.
    if (holdRef.current !== null) return;
    const element = ref.current;
    if (!element) return;
    const smooth = landedRef.current;
    landedRef.current = true;
    element.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, holdUntil]);

  // A different conversation starts unlanded again, so switching chats lands instantly too.
  const chatKey = dependencies[0];
  useEffect(() => {
    landedRef.current = false;
  }, [chatKey]);
}
