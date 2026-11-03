import { useEffect, type RefObject } from "react";

/**
 * Index of the first item whose bottom edge is below `line`, or `count` when there is none.
 * Items are in document order, so their bottoms only grow and half the list can be skipped at
 * each step: a scroll frame measures a handful of messages, not the whole window.
 */
export function firstBelow(count: number, bottomAt: (index: number) => number, line: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (bottomAt(mid) > line) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * The date floating over a scrolled conversation, as in Telegram and WhatsApp: while the reader
 * scrolls, the top of the list says which day they are looking at.
 *
 * The chip is written to directly rather than through state: a scroll fires dozens of times a
 * second, and re-rendering a conversation for each of them would cost more than the feature is
 * worth. It shows only while scrolling, hides a moment after, stays away at the end of the list
 * where the newest messages are, and steps aside when a real date divider is right under it so
 * that two labels never overlap.
 */
export function useStickyDate(areaRef: RefObject<HTMLElement | null>, chipRef: RefObject<HTMLElement | null>, chatKey: unknown) {
  useEffect(() => {
    const area = areaRef.current;
    const chip = chipRef.current;
    if (!area || !chip) return;
    let frame = 0;
    let timer = 0;
    const hide = () => chip.classList.remove("shown");
    const update = () => {
      frame = 0;
      // Where the pill is drawn, measured rather than assumed: the list's padding differs
      // between a phone and a desktop. It keeps its place while hidden, so this is always real.
      const pill = chip.firstElementChild!;
      const { top, bottom } = pill.getBoundingClientRect();
      const items = area.querySelectorAll<HTMLElement>("[data-window-item]");
      // The wrapper has no box of its own (display: contents); the message inside has.
      const index = firstBelow(items.length, (i) => items[i].firstElementChild?.getBoundingClientRect().bottom ?? 0, top);
      const day = items[index]?.dataset.day;
      const atEnd = area.scrollHeight - area.clientHeight - area.scrollTop <= 24;
      const crowded = Array.from(area.querySelectorAll(".date-divider"), (divider) => divider.getBoundingClientRect()).some(
        (box) => box.bottom > top - 6 && box.top < bottom + 6
      );
      if (!day || atEnd || crowded) return hide();
      pill.textContent = day;
      chip.classList.add("shown");
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
      clearTimeout(timer);
      timer = window.setTimeout(hide, 1500);
    };
    area.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      area.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      hide();
    };
  }, [areaRef, chipRef, chatKey]);
}
