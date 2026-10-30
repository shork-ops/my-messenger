import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/**
 * Keeps the newest message in view.
 *
 * `holdUntil` lets the caller mark the state - such as a chat that opened on its
 * first unread message - where jumping to the bottom would undo something more
 * useful than it achieves.
 *
 * Two things here were learned the hard way.
 *
 * `scrollIntoView` is not reliable for this. It scrolls every scrollable ancestor, and it
 * leaves the list short of the bottom while the browser is still deciding how tall the
 * content is. Setting `scrollTop` on the list itself has one meaning and cannot be
 * re-interpreted by an ancestor.
 *
 * The jump also has to survive messages arriving afterwards. A conversation loaded from
 * the cloud renders its first frames empty or short: the list is already at the bottom of
 * nothing, and when the messages land the list grows downwards, leaving the reader at the
 * top. That is exactly the report "it opens at the beginning of the conversation". So the
 * landing is repeated while the content keeps growing.
 *
 * A reader who scrolls up has taken the list over, and is left alone. Telling the two
 * apart is the delicate part: our own jump also fires a `scroll` event, so a programmatic
 * move is marked before it happens and the mark is cleared on the next frame - otherwise
 * the first landing switched the whole thing off and the list never moved again.
 */
export function useAutoScroll(
  containerRef: MutableRefObject<HTMLElement | null>,
  dependencies: unknown[],
  holdUntil?: number | null
) {
  const holdRef = useRef<number | null>(null);
  holdRef.current = holdUntil ?? null;
  const landedRef = useRef(false);
  const stateRef = useRef({
    lastHeight: 0,
    timer: 0,
    userScrolled: false,
    selfScrolling: false,
    observer: null as ResizeObserver | null,
  });

  const chatKey = dependencies[0];

  useEffect(() => {
    const state = stateRef.current;
    state.userScrolled = false;
    state.lastHeight = 0;
    landedRef.current = false;
    window.clearInterval(state.timer);
    state.timer = 0;
    if (chatKey === undefined || chatKey === null) return;

    const jump = (container: HTMLElement, smooth: boolean) => {
      const top = container.scrollHeight;
      state.lastHeight = top;
      state.selfScrolling = true;
      container.scrollTop = top;
      // Cleared after the browser has applied it, so our own scroll is not mistaken for
      // the reader's.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          state.selfScrolling = false;
        });
      });
    };

    const settle = () => {
      const container = containerRef.current;
      if (!container) return;
      // A chat that opened at the unread divider stays there: jumping to the bottom would
      // throw away the one piece of information the reader came for.
      if (holdRef.current !== null) return;
      if (state.userScrolled) return;
      if (container.scrollHeight === state.lastHeight && landedRef.current) return;
      const smooth = landedRef.current;
      landedRef.current = true;
      jump(container, smooth);
    };

    // Once now, then for as long as the conversation keeps arriving. Watching the element
    // catches every growth; a fixed interval guessed at how long a fetch takes and gave up
    // before the messages landed.
    const container = containerRef.current;
    settle();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => settle());
    if (container) observer?.observe(container);
    state.observer = observer;
    // A backstop for content that grows without changing the element's box.
    state.timer = window.setInterval(settle, 120) as unknown as number;
    const stop = window.setTimeout(() => {
      window.clearInterval(state.timer);
      state.timer = 0;
    }, 8000);

    const onScroll = () => {
      if (state.selfScrolling) return;
      const list = containerRef.current;
      if (!list) return;
      // Landing at the bottom is not the reader scrolling away from it.
      const atBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 24;
      if (!atBottom) state.userScrolled = true;
    };
    container?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.clearInterval(state.timer);
      window.clearTimeout(stop);
      state.timer = 0;
      state.observer?.disconnect();
      state.observer = null;
      container?.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatKey]);

  // A new message, or anything else that makes the list taller, lands again.
  useEffect(() => {
    if (holdRef.current !== null) return;
    const state = stateRef.current;
    if (state.userScrolled) return;
    const container = containerRef.current;
    if (!container) return;
    const smooth = landedRef.current;
    landedRef.current = true;
    const top = container.scrollHeight;
    state.lastHeight = top;
    state.selfScrolling = true;
    container.scrollTop = top;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        state.selfScrolling = false;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, holdUntil]);
}
