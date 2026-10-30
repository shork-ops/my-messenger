import { describe, expect, it } from "vitest";
import { firstUnreadIndex, initialScrollTarget, unreadCount, unreadLabel, unreadMessages } from "./unread";
import type { Message } from "../types";

/**
 * The unread boundary.
 *
 * `lastReadAt` is a moment in time, not a message number. The cloud fills it from
 * `member_read_at` through `Date.parse`, and `countUnread` compares it to `createdAt`. The
 * divider has to read it the same way: comparing a message id against a timestamp for a
 * century that has not happened yet is not a comparison that means anything.
 *
 * The earlier version of this file encoded the id reading, which is how the contradiction
 * survived - the tests agreed with one half of the code and the other half disagreed with
 * both.
 */

function message(id: number, createdAt: number, mine = false): Message {
  return { id, remoteId: `r${id}`, author: mine ? "Я" : "Максим", text: `m${id}`, time: "10:00", createdAt, mine };
}

describe("firstUnreadIndex", () => {
  it("lands on the first message written after the read moment", () => {
    const messages = [message(1, 1000), message(2, 2000), message(3, 3000)];
    expect(firstUnreadIndex(messages, 2000)).toBe(2);
  });

  it("ignores message ids entirely", () => {
    // Message ids and timestamps have nothing to do with each other; the boundary must
    // follow the clock.
    const messages = [message(5000, 1000), message(42, 2000), message(9999, 3000)];
    expect(firstUnreadIndex(messages, 1500)).toBe(1);
  });

  it("returns null when everything has been read", () => {
    expect(firstUnreadIndex([message(1, 1000), message(2, 2000)], 5000)).toBeNull();
  });

  it("returns null for an empty chat", () => {
    expect(firstUnreadIndex([], 5)).toBeNull();
  });

  it("returns null when nothing has ever been read", () => {
    expect(firstUnreadIndex([message(1, 1000)], null)).toBeNull();
  });

  it("skips past your own messages so the divider lands on theirs", () => {
    const messages = [message(1, 1000), message(2, 3000, true), message(3, 4000)];
    // Your own message at 3000 is unread too, but a divider above it would claim
    // "unread" over your own words.
    expect(firstUnreadIndex(messages, 2000)).toBe(2);
  });

  it("returns null when only your own messages are unread", () => {
    const messages = [message(1, 1000), message(2, 3000, true), message(3, 4000, true)];
    expect(firstUnreadIndex(messages, 2000)).toBeNull();
  });

  it("lands on the first message when nothing at all was read", () => {
    expect(firstUnreadIndex([message(1, 1000), message(2, 2000)], 0)).toBe(0);
  });

  it("returns null when messages carry no timestamp", () => {
    // A message without createdAt cannot be placed relative to a moment; guessing would put
    // the divider in the wrong place, which is worse than not showing it.
    const untimed: Message[] = [{ id: 1, author: "Максим", text: "?", time: "10:00" }];
    expect(firstUnreadIndex(untimed, 1000)).toBeNull();
  });
});

describe("unreadCount", () => {
  it("counts messages written after the read moment", () => {
    expect(unreadCount([message(1, 1000), message(2, 2000), message(3, 3000)], 1500)).toBe(2);
  });

  it("is zero when everything is read", () => {
    expect(unreadCount([message(1, 1000)], 5000)).toBe(0);
  });

  it("is zero when there is no mark", () => {
    expect(unreadCount([message(1, 1000)], null)).toBe(0);
  });
});

describe("initialScrollTarget", () => {
  it("goes to the bottom when nothing is unread", () => {
    expect(initialScrollTarget([message(1, 1000)], 5000)).toEqual({ kind: "bottom" });
  });

  it("goes to the divider when there are unread messages", () => {
    expect(initialScrollTarget([message(1, 1000), message(2, 2000)], 1500)).toEqual({ kind: "index", index: 1 });
  });
});

describe("unreadMessages", () => {
  it("agrees with firstUnreadIndex about what counts as unread", () => {
    const messages = [message(1, 1000), message(2, 2000), message(3, 3000)];
    expect(unreadMessages({ messages, lastReadAt: 2000 })).toBe(true);
    expect(firstUnreadIndex(messages, 2000)).toBe(2);
  });

  it("reports nothing unread when your own message is the newest", () => {
    const messages = [message(1, 1000), message(2, 3000, true)];
    expect(unreadMessages({ messages, lastReadAt: 2000 })).toBe(false);
    expect(firstUnreadIndex(messages, 2000)).toBeNull();
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
