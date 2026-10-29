import { describe, expect, it } from "vitest";
import {
  EDGE_ZONE_PX,
  MAX_SWIPE_MS,
  MAX_VERTICAL_DRIFT_PX,
  MIN_SWIPE_PX,
  isBackSwipe,
  swipeOffset,
} from "./gestures";

const at = (x: number, y = 300, t = 0) => ({ x, y, t });

describe("isBackSwipe", () => {
  it("accepts a swipe from the edge to the right", () => {
    expect(isBackSwipe(at(10, 300, 0), at(10 + MIN_SWIPE_PX, 300, 200))).toBe(true);
  });

  it("rejects a swipe that starts in the middle of the screen", () => {
    expect(isBackSwipe(at(200, 300, 0), at(280, 300, 200))).toBe(false);
  });

  it("rejects a swipe that is too short", () => {
    expect(isBackSwipe(at(10, 300, 0), at(10 + MIN_SWIPE_PX - 1, 300, 200))).toBe(false);
  });

  it("rejects a swipe to the left", () => {
    expect(isBackSwipe(at(20, 300, 0), at(0, 300, 200))).toBe(false);
  });

  it("rejects a vertical scroll that happens to start at the edge", () => {
    expect(isBackSwipe(at(10, 100, 0), at(10 + MIN_SWIPE_PX, 100 + MAX_VERTICAL_DRIFT_PX + 1, 200))).toBe(false);
  });

  it("allows a little vertical drift, because a finger is not a ruler", () => {
    expect(isBackSwipe(at(10, 100, 0), at(10 + MIN_SWIPE_PX, 100 + MAX_VERTICAL_DRIFT_PX - 5, 200))).toBe(true);
  });

  it("rejects a finger that rested too long before moving", () => {
    expect(isBackSwipe(at(10, 300, 0), at(10 + MIN_SWIPE_PX, 300, MAX_SWIPE_MS + 1))).toBe(false);
  });

  it("rejects a negative duration, which means the clock was mishandled", () => {
    expect(isBackSwipe(at(10, 300, 500), at(10 + MIN_SWIPE_PX, 300, 100))).toBe(false);
  });

  it("has thresholds that do not trip on a normal tap", () => {
    expect(EDGE_ZONE_PX).toBeLessThan(48);
    expect(MIN_SWIPE_PX).toBeGreaterThan(48);
  });

  it("accepts exactly at the boundary", () => {
    expect(isBackSwipe(at(EDGE_ZONE_PX, 0, 0), at(EDGE_ZONE_PX + MIN_SWIPE_PX, 0, MAX_SWIPE_MS))).toBe(true);
  });
});

describe("swipeOffset", () => {
  it("grows with the finger", () => {
    expect(swipeOffset(at(10, 300, 0), at(110, 300, 100), 390)).toBe(100);
  });

  it("never goes negative when the finger moves left", () => {
    expect(swipeOffset(at(100, 300, 0), at(20, 300, 100), 390)).toBe(0);
  });

  it("stops at the screen width", () => {
    expect(swipeOffset(at(0, 300, 0), at(500, 300, 100), 390)).toBe(390);
  });
});
