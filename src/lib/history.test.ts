import { describe, expect, it } from "vitest";
import { canLoadOlder, olderThanCursor, prependOlderMessages } from "./history";
import { badgeCount, formatDocumentTitle } from "./notifications";
import type { Message } from "../types";

function message(overrides: Partial<Message> = {}): Message {
  return { id: 1, author: "Аня", text: "привет", time: "10:00", createdAt: 1000, ...overrides };
}

describe("olderThanCursor", () => {
  it("returns a composite cursor for the oldest loaded message", () => {
    const messages = [
      message({ id: 2, remoteId: "00000000-0000-0000-0000-000000000002", createdAt: Date.UTC(2026, 9, 28, 10, 0, 0) }),
      message({ id: 3, remoteId: "00000000-0000-0000-0000-000000000003", createdAt: Date.UTC(2026, 9, 28, 10, 1, 0) }),
    ];
    expect(olderThanCursor(messages)).toEqual({
      createdAt: new Date(Date.UTC(2026, 9, 28, 10, 0, 0)).toISOString(),
      id: "00000000-0000-0000-0000-000000000002",
    });
  });

  it("returns null for empty lists and local-only messages", () => {
    expect(olderThanCursor([])).toBeNull();
    expect(olderThanCursor([message({ createdAt: 1000, remoteId: undefined })])).toBeNull();
    expect(olderThanCursor([message({ remoteId: "a", createdAt: undefined })])).toBeNull();
  });
});

describe("canLoadOlder", () => {
  it("allows a page only when idle, not exhausted and the first message is remote", () => {
    const remote = [message({ remoteId: "a" })];
    expect(canLoadOlder(remote, false, false)).toBe(true);
    expect(canLoadOlder(remote, true, false)).toBe(false);
    expect(canLoadOlder(remote, false, true)).toBe(false);
    expect(canLoadOlder([], false, false)).toBe(false);
    expect(canLoadOlder([message({ remoteId: undefined })], false, false)).toBe(false);
  });
});

describe("prependOlderMessages", () => {
  it("puts older messages in front of the list", () => {
    const current = [message({ id: 3, remoteId: "c", createdAt: 3000 })];
    const older = [message({ id: 1, remoteId: "a", createdAt: 1000 }), message({ id: 2, remoteId: "b", createdAt: 2000 })];
    expect(prependOlderMessages(current, older).map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("drops messages that are already loaded", () => {
    const current = [message({ id: 2, remoteId: "b", createdAt: 2000 }), message({ id: 3, remoteId: "c", createdAt: 3000 })];
    const older = [message({ id: 1, remoteId: "a", createdAt: 1000 }), message({ id: 2, remoteId: "b", createdAt: 2000 })];
    expect(prependOlderMessages(current, older).map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("returns the same array when nothing new arrives", () => {
    const current = [message({ id: 1, remoteId: "a", createdAt: 1000 })];
    expect(prependOlderMessages(current, [])).toBe(current);
    expect(prependOlderMessages(current, [message({ id: 1, remoteId: "a" })])).toBe(current);
  });

  it("skips rows whose numeric id already exists", () => {
    const current = [message({ id: 5, remoteId: "e", createdAt: 1200 })];
    const older = [message({ id: 5, remoteId: "server-other", createdAt: 1000 })];
    expect(prependOlderMessages(current, older)).toBe(current);
  });
});

describe("formatDocumentTitle", () => {
  it("prefixes the unread count and hides it when zero", () => {
    expect(formatDocumentTitle(3)).toBe("(3) Nexus");
    expect(formatDocumentTitle(0)).toBe("Nexus");
    expect(formatDocumentTitle(1, "Nexus Messenger")).toBe("(1) Nexus Messenger");
  });
});

describe("badgeCount", () => {
  it("clamps the badge to a two-digit range", () => {
    expect(badgeCount(0)).toBe(0);
    expect(badgeCount(7)).toBe(7);
    expect(badgeCount(150)).toBe(99);
    expect(badgeCount(-2)).toBe(0);
  });
});
