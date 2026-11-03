/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firstBelow, useStickyDate } from "./useStickyDate";

describe("firstBelow", () => {
  const bottoms = [10, 30, 50];
  const at = (index: number) => bottoms[index];

  it("finds the first item reaching below the line", () => {
    expect(firstBelow(3, at, 0)).toBe(0);
    expect(firstBelow(3, at, 10)).toBe(1);
    expect(firstBelow(3, at, 49)).toBe(2);
  });

  it("says so when nothing is below", () => {
    expect(firstBelow(3, at, 50)).toBe(3);
    expect(firstBelow(0, at, 0)).toBe(0);
  });

  it("measures only a few items of a long list", () => {
    const measured = vi.fn((index: number) => index * 10 + 10);
    expect(firstBelow(1000, measured, 4321)).toBe(432);
    expect(measured.mock.calls.length).toBeLessThanOrEqual(11);
  });
});

/** A list as the conversation renders it: wrappers without a box, a message inside each. */
function conversation(days: string[], { scrollTop = 500, dividerAt = null as number | null } = {}) {
  const area = document.createElement("div");
  const chip = document.createElement("div");
  chip.append(document.createElement("span"));
  area.append(chip);
  days.forEach((day, index) => {
    const item = document.createElement("div");
    item.dataset.windowItem = "";
    item.dataset.day = day;
    const bubble = document.createElement("div");
    // Each message is 50px tall; the list is scrolled by `scrollTop`.
    bubble.getBoundingClientRect = () => ({ top: index * 50 - scrollTop, bottom: (index + 1) * 50 - scrollTop }) as DOMRect;
    item.append(bubble);
    area.append(item);
  });
  if (dividerAt !== null) {
    const divider = document.createElement("div");
    divider.className = "date-divider";
    divider.getBoundingClientRect = () => ({ top: dividerAt }) as DOMRect;
    area.append(divider);
  }
  area.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  Object.defineProperty(area, "scrollHeight", { value: days.length * 50 });
  Object.defineProperty(area, "clientHeight", { value: 400 });
  area.scrollTop = scrollTop;
  document.body.append(area);
  return { area, chip, label: () => chip.firstElementChild!.textContent, shown: () => chip.classList.contains("shown") };
}

describe("useStickyDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  const days = [...Array(20).fill("1 ноября"), ...Array(20).fill("Вчера"), ...Array(20).fill("Сегодня")];

  it("shows the day of the message at the top while scrolling, then steps away", () => {
    const list = conversation(days, { scrollTop: 1100 });
    renderHook(() => useStickyDate({ current: list.area }, { current: list.chip }, 1));
    expect(list.shown()).toBe(false);

    list.area.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    // 1100px down, the 23rd message is at the top: the second day.
    expect(list.label()).toBe("Вчера");
    expect(list.shown()).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(list.shown()).toBe(false);
  });

  it("keeps out of the way at the end of the list, where the newest messages are", () => {
    const list = conversation(days, { scrollTop: 60 * 50 - 400 });
    renderHook(() => useStickyDate({ current: list.area }, { current: list.chip }, 1));
    list.area.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    expect(list.shown()).toBe(false);
  });

  it("gives way to a real divider right under it, so two dates never overlap", () => {
    const list = conversation(days, { scrollTop: 300, dividerAt: 12 });
    renderHook(() => useStickyDate({ current: list.area }, { current: list.chip }, 1));
    list.area.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    expect(list.shown()).toBe(false);
  });

  it("stops listening when the conversation goes away", () => {
    const list = conversation(days, { scrollTop: 300 });
    const { unmount } = renderHook(() => useStickyDate({ current: list.area }, { current: list.chip }, 1));
    list.area.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    expect(list.label()).toBe("1 ноября");
    expect(list.shown()).toBe(true);
    unmount();
    // Leaving hides it at once, and a later scroll of the same element does nothing.
    expect(list.shown()).toBe(false);
    list.area.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    expect(list.shown()).toBe(false);
  });
});
