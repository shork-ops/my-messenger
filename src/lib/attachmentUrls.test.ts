import { describe, expect, it } from "vitest";
import { collectExpiringAttachments, needsRefresh, nextRefreshDelay, withRefreshedUrl } from "./attachmentUrls";
import type { Chat } from "../types";

const NOW = 1_700_000_000_000;
const MARGIN = 5 * 60_000;

function chatWithAttachment(id: number, messageId: number, expiresAt?: number, path = "p/file.png"): Chat {
  return {
    id,
    name: `chat ${id}`,
    avatar: "C",
    color: "blue",
    preview: "",
    time: "10:00",
    messages: [
      {
        id: messageId,
        author: "A",
        text: "file",
        time: "10:00",
        createdAt: NOW,
        attachment: { name: "f.png", type: "image/png", data: "https://x", size: 10, path, expiresAt },
      },
    ],
  };
}

describe("collectExpiringAttachments", () => {
  it("returns attachments inside the refresh margin", () => {
    const chats = [chatWithAttachment(1, 11, NOW + 60_000)];
    const due = collectExpiringAttachments(chats, NOW, MARGIN);
    expect(due).toEqual([{ chatId: 1, messageId: 11, path: "p/file.png", expiresAt: NOW + 60_000 }]);
  });

  it("ignores attachments that are still fresh", () => {
    const chats = [chatWithAttachment(1, 11, NOW + 30 * 60_000)];
    expect(collectExpiringAttachments(chats, NOW, MARGIN)).toEqual([]);
  });

  it("ignores inline attachments with no expiry", () => {
    const chats = [chatWithAttachment(1, 11, undefined)];
    expect(collectExpiringAttachments(chats, NOW, MARGIN)).toEqual([]);
  });

  it("sorts by expiry so the most urgent is refreshed first", () => {
    const chats = [chatWithAttachment(1, 11, NOW + 120_000), chatWithAttachment(2, 22, NOW + 30_000)];
    expect(collectExpiringAttachments(chats, NOW, MARGIN).map((item) => item.chatId)).toEqual([2, 1]);
  });
});

describe("nextRefreshDelay", () => {
  it("returns null when nothing expires", () => {
    expect(nextRefreshDelay([chatWithAttachment(1, 11)], NOW)).toBeNull();
  });

  it("sleeps until the earliest expiry minus the margin", () => {
    const chats = [chatWithAttachment(1, 11, NOW + 600_000)];
    expect(nextRefreshDelay(chats, NOW, MARGIN)).toBe(600_000 - MARGIN);
  });

  it("floors at one second instead of spinning on an already-due URL", () => {
    const chats = [chatWithAttachment(1, 11, NOW - 10_000)];
    expect(nextRefreshDelay(chats, NOW, MARGIN)).toBe(1000);
  });

  it("takes the soonest across chats", () => {
    const chats = [chatWithAttachment(1, 11, NOW + 600_000), chatWithAttachment(2, 22, NOW + 400_000)];
    expect(nextRefreshDelay(chats, NOW, MARGIN)).toBe(400_000 - MARGIN);
  });
});

describe("withRefreshedUrl", () => {
  it("replaces the URL and expiry of the matching message", () => {
    const chats = [chatWithAttachment(1, 11, NOW)];
    const next = withRefreshedUrl(chats, { chatId: 1, messageId: 11 }, "https://fresh", NOW + 3600_000);
    expect(next[0].messages[0].attachment?.data).toBe("https://fresh");
    expect(next[0].messages[0].attachment?.expiresAt).toBe(NOW + 3600_000);
    // Other fields are preserved.
    expect(next[0].messages[0].attachment?.path).toBe("p/file.png");
  });

  it("returns the same array when nothing matched, so React can skip rendering", () => {
    const chats = [chatWithAttachment(1, 11, NOW)];
    expect(withRefreshedUrl(chats, { chatId: 9, messageId: 99 }, "https://fresh", NOW)).toBe(chats);
  });

  it("leaves other chats untouched", () => {
    const chats = [chatWithAttachment(1, 11, NOW), chatWithAttachment(2, 22, NOW)];
    const next = withRefreshedUrl(chats, { chatId: 1, messageId: 11 }, "https://fresh", NOW);
    expect(next[1]).toBe(chats[1]);
  });
});

describe("needsRefresh", () => {
  it("is true when the URL is missing", () => {
    expect(needsRefresh({ name: "f", type: "image/png", size: 1, data: "", path: "p" }, NOW)).toBe(true);
  });

  it("is true inside the margin", () => {
    expect(needsRefresh({ name: "f", type: "image/png", size: 1, data: "u", path: "p", expiresAt: NOW + 1000 }, NOW)).toBe(true);
  });

  it("is false for a fresh URL", () => {
    expect(needsRefresh({ name: "f", type: "image/png", size: 1, data: "u", path: "p", expiresAt: NOW + 3600_000 }, NOW)).toBe(false);
  });

  it("is false for inline attachments without a path", () => {
    expect(needsRefresh({ name: "f", type: "image/png", size: 1, data: "data:abc" }, NOW)).toBe(false);
  });
});
