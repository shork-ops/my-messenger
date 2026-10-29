import { describe, expect, it } from "vitest";
import { placeNewMessage } from "./messageOrder";
import type { Message } from "../types";

function message(overrides: Partial<Message> = {}): Message {
  return { id: 1, author: "Аня", text: "привет", time: "10:00", createdAt: 1000, ...overrides };
}

describe("placeNewMessage", () => {
  it("appends a message newer than everything in the list", () => {
    const existing = [message({ id: 1, createdAt: 1000 }), message({ id: 2, createdAt: 2000 })];
    const result = placeNewMessage(existing, message({ id: 3, createdAt: 3000 }));
    expect(result.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("keeps the tail position for an empty conversation", () => {
    expect(placeNewMessage([], message({ id: 1 }))).toHaveLength(1);
  });

  // The point of the helper: a message confirmed by the server can carry a timestamp
  // slightly behind the newest one already shown, because the two clocks differ.
  it("inserts by timestamp when the server puts it before the newest", () => {
    const existing = [message({ id: 1, createdAt: 1000 }), message({ id: 3, createdAt: 3000 })];
    const result = placeNewMessage(existing, message({ id: 2, createdAt: 2000 }));
    expect(result.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  // Same millisecond is common when a message is echoed back; the id breaks the tie so
  // the order does not depend on arrival.
  it("breaks a tie in the same millisecond by id", () => {
    const existing = [message({ id: 5, createdAt: 1000 })];
    const result = placeNewMessage(existing, message({ id: 4, createdAt: 1000 }));
    expect(result.map((item) => item.id)).toEqual([4, 5]);
  });

  it("does not reorder an existing list it refuses to change", () => {
    const existing = [message({ id: 1, createdAt: 1000 }), message({ id: 2, createdAt: 2000 })];
    const result = placeNewMessage(existing, message({ id: 3, createdAt: 3000 }));
    expect(result).not.toBe(existing);
    expect(existing.map((item) => item.id)).toEqual([1, 2]);
  });

  it("appends a message with no timestamp rather than dropping it", () => {
    const existing = [message({ id: 1, createdAt: 1000 })];
    const result = placeNewMessage(existing, message({ id: 2, createdAt: undefined }));
    expect(result.map((item) => item.id)).toEqual([1, 2]);
  });
});
