import { describe, expect, it } from "vitest";
import { firstUnreadIndex, initialScrollTarget, unreadCount, unreadLabel } from "./unread";

const msgs = (spec: [number, boolean][]) => spec.map(([id, mine]) => ({ id, mine }));

describe("firstUnreadIndex", () => {
  it("finds the first message after the read mark", () => {
    expect(firstUnreadIndex(msgs([[1, false], [2, false], [3, false]]), 1)).toBe(1);
  });

  it("returns null when everything has been read", () => {
    expect(firstUnreadIndex(msgs([[1, false], [2, false]]), 2)).toBeNull();
  });

  it("returns null for an empty chat", () => {
    expect(firstUnreadIndex([], 5)).toBeNull();
  });

  it("returns null when nothing has ever been read", () => {
    expect(firstUnreadIndex(msgs([[1, false]]), null)).toBeNull();
  });

  it("skips past your own messages so the divider lands on theirs", () => {
    // 2 and 3 are unread, but 2 is mine: the divider belongs above 3.
    expect(firstUnreadIndex(msgs([[1, false], [2, true], [3, false]]), 1)).toBe(2);
  });

  it("returns null when only your own messages are unread", () => {
    expect(firstUnreadIndex(msgs([[1, false], [2, true], [3, true]]), 1)).toBeNull();
  });

  it("lands on index 0 when nothing at all was read", () => {
    expect(firstUnreadIndex(msgs([[1, false], [2, false]]), 0)).toBe(0);
  });
});

describe("unreadCount", () => {
  it("counts everything after the mark, including your own", () => {
    expect(unreadCount([{ id: 1 }, { id: 2 }, { id: 3 }], 1)).toBe(2);
  });

  it("is zero when everything is read", () => {
    expect(unreadCount([{ id: 1 }], 1)).toBe(0);
  });

  it("is zero when there is no mark", () => {
    expect(unreadCount([{ id: 1 }], null)).toBe(0);
  });
});

describe("initialScrollTarget", () => {
  it("goes to the bottom when nothing is unread", () => {
    expect(initialScrollTarget(msgs([[1, false]]), 1)).toEqual({ kind: "bottom" });
  });

  it("goes to the divider when there are unread messages", () => {
    expect(initialScrollTarget(msgs([[1, false], [2, false]]), 1)).toEqual({ kind: "index", index: 1 });
  });
});

describe("unreadLabel", () => {
  it("says nothing for zero", () => {
    expect(unreadLabel(0)).toBe("");
  });

  it("uses the singular for one", () => {
    expect(unreadLabel(1)).toMatch(/непрочитанное/);
  });

  it("uses the plural for more", () => {
    expect(unreadLabel(3)).toMatch(/^3 непрочитанных$/);
    expect(unreadLabel(12)).toMatch(/^12 непрочитанных$/);
  });
});
