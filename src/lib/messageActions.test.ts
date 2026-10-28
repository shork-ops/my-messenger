import { describe, expect, it } from "vitest";
import {
  FAVOURITES_CHAT_ID,
  FAVOURITES_TITLE,
  createFavouritesChat,
  favouriteMessage,
  formatForwardText,
  isFavouritesChat,
  isForwarded,
  nextLocalId,
  splitForward,
} from "./messageActions";
import type { Message } from "../types";

const baseMessage: Message = {
  id: 7,
  author: "Аня",
  text: "Смотри, что нашёл",
  time: "12:41",
  createdAt: 1_700_000_000_000,
};

describe("forwarding", () => {
  it("names the original author in the forwarded body", () => {
    const text = formatForwardText(baseMessage);
    expect(text).toBe("↪ Переслано от Аня:\nСмотри, что нашёл");
    expect(isForwarded(text)).toBe(true);
  });

  it("does not add the prefix twice when forwarding a forward", () => {
    const once = formatForwardText(baseMessage);
    const twice = formatForwardText({ author: "Игорь", text: once });
    expect(twice.split("↪ Переслано")).toHaveLength(3);
    // The outer prefix is the only one split off as a label.
    const { label, body } = splitForward(twice);
    expect(label).toBe("↪ Переслано от Игорь:");
    expect(body).toBe(once);
  });

  it("leaves plain messages untouched", () => {
    expect(isForwarded("обычное сообщение")).toBe(false);
    expect(splitForward("обычное сообщение")).toEqual({ label: null, body: "обычное сообщение" });
  });

  it("handles a prefixed message with no body", () => {
    expect(splitForward("↪ Переслано от Аня:")).toEqual({ label: "↪ Переслано от Аня:", body: "" });
  });
});

describe("favourites", () => {
  it("creates a single reserved chat", () => {
    const chat = createFavouritesChat();
    expect(chat.id).toBe(FAVOURITES_CHAT_ID);
    expect(chat.name).toBe(FAVOURITES_TITLE);
    expect(isFavouritesChat(chat)).toBe(true);
  });

  it("recognises the chat by name after a reload", () => {
    expect(isFavouritesChat({ id: 42, name: FAVOURITES_TITLE })).toBe(true);
    expect(isFavouritesChat({ id: 42, name: "Игорь" })).toBe(false);
  });

  it("copies the message content with a new id and keeps the original author", () => {
    const saved = favouriteMessage(baseMessage, 99);
    expect(saved.id).toBe(99);
    expect(saved.author).toBe("Аня");
    expect(saved.text).toBe("Смотри, что нашёл");
    expect(saved.createdAt).toBeDefined();
    // The original object is not mutated.
    expect(baseMessage.id).toBe(7);
  });
});

describe("nextLocalId", () => {
  it("returns the next free id", () => {
    expect(nextLocalId([])).toBe(1);
    expect(nextLocalId([{ ...baseMessage, id: 3 }, { ...baseMessage, id: 11 }])).toBe(12);
  });
});
