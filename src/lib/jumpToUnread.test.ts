import { describe, expect, it } from "vitest";
import { jumpButton, scrollTarget } from "./jumpToUnread";

/**
 * Which button a conversation offers, and where it scrolls.
 *
 * The rule: the button must always be about somewhere the reader is not. Offering "jump to
 * the end" while already at the end is a button that does nothing, and a button that does
 * nothing teaches people to ignore the button.
 */

describe("jumpButton", () => {
  it("offers the unread jump while the reader is above the first unread message", () => {
    expect(jumpButton({ atBottom: false, hasUnreadBelow: true, unreadCount: 3 })).toEqual({
      kind: "unread",
      count: 3,
    });
  });

  it("offers the end jump when scrolled up with nothing unread", () => {
    expect(jumpButton({ atBottom: false, hasUnreadBelow: false, unreadCount: 0 })).toEqual({
      kind: "end",
      count: 0,
    });
  });

  it("offers nothing when the reader is already at the end with nothing unread", () => {
    expect(jumpButton({ atBottom: true, hasUnreadBelow: false, unreadCount: 0 })).toBeNull();
  });

  it("prefers the unread jump over the end jump when both apply", () => {
    expect(jumpButton({ atBottom: false, hasUnreadBelow: true, unreadCount: 2 })?.kind).toBe("unread");
  });

  it("offers nothing when the reader is at the end even with a stale unread count", () => {
    // The count lags behind the read state; the position is what the reader sees.
    expect(jumpButton({ atBottom: true, hasUnreadBelow: false, unreadCount: 5 })).toBeNull();
  });
});

describe("scrollTarget", () => {
  it("puts the divider a third of the screen down so the context above it is visible", () => {
    // Divider at 5000 in a 3000-tall content area, viewport 600.
    expect(scrollTarget({ dividerTop: 5000, viewportHeight: 600, contentHeight: 9000 })).toBe(4800);
  });

  it("never scrolls past the start", () => {
    expect(scrollTarget({ dividerTop: 100, viewportHeight: 600, contentHeight: 3000 })).toBe(0);
  });

  it("never scrolls past the end", () => {
    expect(scrollTarget({ dividerTop: 8900, viewportHeight: 600, contentHeight: 9000 })).toBe(8400);
  });
});
