import { useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/**
 * Keeps the newest message in view.
 *
 * `holdUntil` lets the caller mark the state - such as a chat that opened on its
 * first unread message - where jumping to the bottom would undo something more
 * useful than it achieves.
 *
 * The hard part is not the jump; it is knowing when to stop jumping.
 *
 * A conversation is not one render. It is a first paint with nothing to show, a fetch, a
 * second paint with fifty messages, then avatars and pictures resolving one by one, each
 * changing the height of what is already on screen. A jump measured at any single moment
 * lands correctly for that moment and is wrong a frame later. So the list is held at the
 * bottom for as long as its content keeps changing, and released only when the reader
 * scrolls - which is the one event that says they are reading something else.
 *
 * `useLayoutEffect` rather than `useEffect`: the jump happens before the browser paints, so
 * a long conversation never flashes its beginning first.
 *
 * `scrollIntoView` is not used. It scrolls every scrollable ancestor and leaves the list
 * short of the bottom while the browser is still deciding how tall the content is. Setting
 * `scrollTop` on the list has one meaning.
 */
export function useAutoScroll(
  containerRef: MutableRefObject<HTMLElement | null>,
  dependencies: unknown[],
  holdUntil?: number | null
) {
  const holdRef = useRef<number | null>(null);
  holdRef.current = holdUntil ?? null;
  const stateRef = useRef({
    /** The reader has scrolled away; leave them where they are. */
    released: false,
    /** A scroll event we caused ourselves, not the reader. */
    selfScrolling: false,
    /** Last known content height, so a change can be told from a steady list. */
    lastHeight: -1,
    frame: 0,
    observer: null as ResizeObserver | null,
  });

  const chatKey = dependencies[0];

  /** Put the list at the bottom, without letting that count as the reader scrolling. */
  const pin = (container: HTMLElement) => {
    const state = stateRef.current;
    const top = Math.max(0, container.scrollHeight - container.clientHeight);
    if (Math.abs(container.scrollTop - top) < 1) return;
    state.selfScrolling = true;
    container.scrollTop = top;
    // Cleared after the browser has delivered the scroll event this caused.
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(() => {
      state.frame = requestAnimationFrame(() => {
        state.selfScrolling = false;
      });
    });
  };

  // One chat: attach the guard and the observer, and hold the bottom until released.
  useLayoutEffect(() => {
    const state = stateRef.current;
    state.released = false;
    state.lastHeight = -1;
    state.selfScrolling = false;
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.observer?.disconnect();
    state.observer = null;
    if (chatKey === undefined || chatKey === null) return;

    const container = containerRef.current;
    if (!container) return;

    // Hold while the conversation is still arriving. Every growth of the content is a
    // reason to land again; a scroll the reader caused is a reason to stop for good.
    const hold = () => {
      if (state.released) return;
      if (holdRef.current !== null) return;
      const list = containerRef.current;
      if (!list) return;
      pin(list);
      state.lastHeight = list.scrollHeight;
    };

    hold();

    const onScroll = () => {
      if (state.selfScrolling) return;
      const list = containerRef.current;
      if (!list) return;
      // Our own pin lands on the bottom; anything clearly above it is the reader.
      const distance = list.scrollHeight - list.clientHeight - list.scrollTop;
      if (distance > 24) {
        state.released = true;
      } else if (state.released) {
        // Scrolling back to the newest message is a request to follow it again. Without
        // this, a reader who glanced up once would never see a new message arrive.
        state.released = false;
        hold();
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => hold());
    if (observer) {
      // The list's own box changes when the window resizes; the content inside it changes
      // when a message, an avatar or a picture arrives. Both mean "land again".
      observer.observe(container);
      for (const child of Array.from(container.children)) observer.observe(child);
    }
    state.observer = observer;

    // A backstop for content that changes without resizing anything observable.
    const timer = window.setInterval(hold, 150);
    const stop = window.setTimeout(() => window.clearInterval(timer), 10000);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
      observer?.disconnect();
      state.observer = null;
      container.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatKey]);

  // Anything that changes the conversation after it opened: a new message, an older page,
  // an image finishing. Repeated here because the effect above only runs per chat.
  useLayoutEffect(() => {
    if (holdRef.current !== null) return;
    const state = stateRef.current;
    if (state.released) return;
    const container = containerRef.current;
    if (!container) return;
    pin(container);
    state.lastHeight = container.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, holdUntil]);

  // A window that changes size changes what "the bottom" means.
  useLayoutEffect(() => {
    const onResize = () => {
      const state = stateRef.current;
      if (state.released || holdRef.current !== null) return;
      const container = containerRef.current;
      if (!container) return;
      pin(container);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [containerRef]);
}
