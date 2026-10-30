import { describe, expect, it } from "vitest";
import { RENDER_WINDOW, initialWindow, nearbyWindow, visibleRange, windowAround } from "./messageWindow";

/**
 * The render window for a long conversation.
 *
 * A five-thousand-message chat put sixty thousand nodes in the DOM and took two and a half
 * seconds to open. The fix is to render a slice and leave the rest as space of the right
 * height - but the scroll position is the fragile part, and it is where this project has
 * broken three times already. So the arithmetic lives here, where it can be checked without a
 * browser.
 *
 * The invariant every function below obeys: the window never changes the total height, so
 * replacing a placeholder with real messages never moves anything.
 */

describe("visibleRange", () => {
  it("finds the messages around the viewport", () => {
    // 100 messages of 50px in a 500px viewport scrolled 500px: messages 10..20 are visible.
    expect(visibleRange({ scrollTop: 500, viewportHeight: 500, itemHeight: 50, count: 100 })).toEqual({
      first: 10,
      last: 20,
    });
  });

  it("starts at zero at the top", () => {
    expect(visibleRange({ scrollTop: 0, viewportHeight: 500, itemHeight: 50, count: 100 }).first).toBe(0);
  });

  it("never goes past the end", () => {
    const range = visibleRange({ scrollTop: 100_000, viewportHeight: 500, itemHeight: 50, count: 100 });
    expect(range.last).toBe(100);
  });

  it("handles an empty list without dividing by zero", () => {
    expect(visibleRange({ scrollTop: 0, viewportHeight: 500, itemHeight: 0, count: 0 })).toEqual({ first: 0, last: 0 });
  });

  it("survives a negative scroll, which some browsers report during rubber-banding", () => {
    expect(visibleRange({ scrollTop: -80, viewportHeight: 500, itemHeight: 50, count: 100 }).first).toBe(0);
  });
});

describe("windowAround", () => {
  it("keeps the visible range and adds a margin on both sides", () => {
    const window = windowAround({ first: 40, last: 60 }, 100);
    expect(window.first).toBeLessThan(40);
    expect(window.last).toBeGreaterThan(60);
    expect(window.first).toBe(40 - RENDER_WINDOW);
    expect(window.last).toBe(60 + RENDER_WINDOW);
  });

  it("clamps to the ends of the list", () => {
    expect(windowAround({ first: 0, last: 5 }, 100).first).toBe(0);
    expect(windowAround({ first: 95, last: 100 }, 100).last).toBe(100);
  });

  it("renders everything when the list is small", () => {
    const window = windowAround({ first: 0, last: 3 }, 10);
    expect(window).toEqual({ first: 0, last: 10 });
  });
});

describe("initialWindow", () => {
  it("opens at the end, where a conversation is read from", () => {
    expect(initialWindow(5000)).toEqual({ first: 5000 - RENDER_WINDOW * 2, last: 5000 });
  });

  it("covers a short conversation entirely", () => {
    expect(initialWindow(20)).toEqual({ first: 0, last: 20 });
  });

  it("handles an empty conversation", () => {
    expect(initialWindow(0)).toEqual({ first: 0, last: 0 });
  });
});

describe("nearbyWindow", () => {
  it("does not shrink an already wider window", () => {
    const current = { first: 10, last: 90 };
    // A small move must not throw away what is already rendered, or scrolling would flap
    // between sizes and the reader would see it.
    expect(nearbyWindow(current, { first: 40, last: 60 }, 100, 10)).toEqual(current);
  });

  it("follows the reader when they leave the window", () => {
    const current = { first: 40, last: 60 };
    const next = nearbyWindow(current, { first: 100, last: 120 }, 300, 10);
    expect(next.last).toBeGreaterThanOrEqual(130);
    expect(next.first).toBeGreaterThan(current.first);
  });

  it("shrinks back when the reader jumps to the top of a long chat", () => {
    // Growing only was the first implementation, and jumping to the top of a five-thousand
    // message chat left every message rendered - the state the window exists to prevent.
    const current = { first: 0, last: 3000 };
    const next = nearbyWindow(current, { first: 4980, last: 5000 }, 5000, 20);
    expect(next.last).toBe(5000);
    expect(next.first).toBe(4960);
    expect(next.last - next.first).toBeLessThan(100);
  });

  it("still clamps to the list", () => {
    const next = nearbyWindow({ first: 0, last: 20 }, { first: 290, last: 300 }, 300, 10);
    expect(next.last).toBe(300);
  });
});
