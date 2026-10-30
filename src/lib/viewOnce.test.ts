import { describe, expect, it } from "vitest";
import {
  VIEW_ONCE_SECONDS,
  isSpent,
  isViewOnce,
  markSpent,
  nextViewOnceState,
  remainingSeconds,
  viewOnceSpentLabel,
  viewOnceVisible,
  viewOnceWarning,
} from "./viewOnce";

describe("view once", () => {
  it("recognises the marker only when it is exactly true", () => {
    expect(isViewOnce({ viewOnce: true })).toBe(true);
    // A truthy string is not a decision the app made; treating it as one would hide a photo
    // the sender meant to be looked at normally.
    expect(isViewOnce({ viewOnce: "true" })).toBe(false);
    expect(isViewOnce({ viewOnce: 1 })).toBe(false);
    expect(isViewOnce({})).toBe(false);
    expect(isViewOnce(null)).toBe(false);
    expect(isViewOnce(undefined)).toBe(false);
  });

  it("warns before opening, and says how long it will stay", () => {
    const text = viewOnceWarning();
    expect(text).toContain(String(VIEW_ONCE_SECONDS));
    expect(text).toContain("только один раз");
  });

  it("counts down and never goes negative", () => {
    const start = 1_000_000;
    expect(remainingSeconds(start, start)).toBe(VIEW_ONCE_SECONDS);
    expect(remainingSeconds(start, start + 4000)).toBe(VIEW_ONCE_SECONDS - 4);
    expect(remainingSeconds(start, start + VIEW_ONCE_SECONDS * 1000)).toBe(0);
    expect(remainingSeconds(start, start + 60_000)).toBe(0);
  });

  it("moves closed -> open -> spent and never back", () => {
    expect(nextViewOnceState("closed")).toBe("open");
    expect(nextViewOnceState("open")).toBe("spent");
    expect(nextViewOnceState("spent")).toBe("spent");
  });

  it("paints the media only while it is open", () => {
    expect(viewOnceVisible("closed")).toBe(false);
    expect(viewOnceVisible("open")).toBe(true);
    expect(viewOnceVisible("spent")).toBe(false);
  });

  it("says the photo is gone in words that do not promise a screenshot alarm", () => {
    const text = viewOnceSpentLabel();
    expect(text).toContain("больше нельзя");
    // No false claim of detection: a browser cannot reliably know about a screenshot.
    expect(text).not.toMatch(/скриншот/i);
  });
});

/**
 * Single-view media is only a promise if "already opened" survives leaving the conversation.
 * These run in the node environment, where there is no localStorage: the module must stay
 * quiet then rather than throw, because the same code is imported by the tests and the build.
 */
describe("remembering what was opened", () => {
  it("does nothing and throws nothing without a browser", () => {
    expect(isSpent("anything")).toBe(false);
    expect(() => markSpent("anything")).not.toThrow();
    expect(isSpent("anything")).toBe(false);
  });
});
