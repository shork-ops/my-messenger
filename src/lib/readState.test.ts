import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { countUnread, isReadByEveryone, receiptFor, canMarkRead } from "./readState";

function message(overrides: Partial<Message> = {}): Message {
  return { id: 1, author: "Аня", text: "привет", time: "10:00", createdAt: 1000, ...overrides };
}

describe("countUnread", () => {
  it("counts only incoming messages newer than the read timestamp", () => {
    const messages = [
      message({ id: 1, createdAt: 900, mine: false }),
      message({ id: 2, createdAt: 1100, mine: false }),
      message({ id: 3, createdAt: 1200, mine: true }),
      message({ id: 4, createdAt: 1300, mine: false }),
    ];
    expect(countUnread(messages, 1000)).toBe(2);
  });

  it("treats a missing read timestamp as never read", () => {
    const messages = [message({ id: 1, mine: false }), message({ id: 2, mine: true })];
    expect(countUnread(messages, null)).toBe(1);
  });

  it("ignores messages without timestamps", () => {
    expect(countUnread([message({ id: 1, createdAt: undefined })], null)).toBe(0);
  });
});

describe("isReadByEveryone", () => {
  it("is true when every other member read past the message", () => {
    const own = message({ mine: true, createdAt: 5000 });
    expect(isReadByEveryone(own, { self: 6000, other: 5000 }, "self")).toBe(true);
  });

  it("is false when someone has not caught up", () => {
    const own = message({ mine: true, createdAt: 5000 });
    expect(isReadByEveryone(own, { self: 6000, other: 4000 }, "self")).toBe(false);
  });

  it("is false for chats without other members", () => {
    expect(isReadByEveryone(message({ mine: true }), { self: 9000 }, "self")).toBe(false);
  });

  it("is false for incoming messages", () => {
    expect(isReadByEveryone(message({ mine: false }), { other: 9000 }, "self")).toBe(false);
  });
});

describe("receiptFor", () => {
  it("returns read, sent or null", () => {
    const own = message({ mine: true, createdAt: 5000 });
    expect(receiptFor(own, { self: 6000, other: 5000 }, "self")).toBe("read");
    expect(receiptFor(own, { self: 6000, other: 1000 }, "self")).toBe("sent");
    expect(receiptFor(message({ mine: false }), { other: 5000 }, "self")).toBeNull();
  });
});

describe("canMarkRead", () => {
  const onScreen = { chatOpen: true, conversationOnScreen: true, documentVisible: true };

  it("stamps a message that arrives in the conversation being read", () => {
    expect(canMarkRead(onScreen)).toBe(true);
  });

  it("does not stamp when the app is open but no conversation is", () => {
    expect(canMarkRead({ ...onScreen, chatOpen: false })).toBe(false);
  });

  it("does not stamp when the phone is showing the chat list", () => {
    expect(canMarkRead({ ...onScreen, conversationOnScreen: false })).toBe(false);
  });

  it("does not stamp when the tab is in the background", () => {
    expect(canMarkRead({ ...onScreen, documentVisible: false })).toBe(false);
  });
});
