/**
 * Taking your data out.
 *
 * These functions were inside the messenger hook, where the only way to reach them was to
 * render the whole app. What matters about them is what they promise: a text export contains
 * the messages that were really sent, and the archive copies settings without reinterpreting
 * them.
 */

/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { chatsForArchive, chatAsText, chatAsTextCount, settingsForArchive } from "./exportAccount";
import { scopedStore } from "./scopedStorage";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
import type { Chat, Message } from "../types";

function message(id: number, text: string, mine = false): Message {
  return {
    id,
    author: mine ? "Я" : "Собеседник",
    text,
    time: "12:00",
    mine,
    createdAt: Date.UTC(2026, 0, 1, 9, 0),
  };
}

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 1,
    name: "Переписка",
    avatar: "С",
    color: "#000",
    preview: "",
    time: "",
    messages: [message(1, "привет"), message(2, "ответ", true)],
    ...overrides,
  } as Chat;
}

describe("a conversation as text", () => {
  it("contains what was said", () => {
    const text = chatAsText(chat());
    expect(text).toContain("привет");
    expect(text).toContain("ответ");
  });

  it("leaves out messages that were never sent", () => {
    // A negative id is a message still being composed; it is not part of the conversation yet.
    const pending = chat({ messages: [message(1, "привет"), message(-5, "черновик")] });
    expect(chatAsTextCount(pending)).toBe(1);
    expect(chatAsText(pending)).not.toContain("черновик");
  });

  it("counts only the messages it exports", () => {
    expect(chatAsTextCount(chat())).toBe(2);
  });
});

describe("the account archive", () => {
  it("skips conversations that have nothing in them", () => {
    const empty = chat({ id: 2, name: "Пустой", messages: [] });
    const names = chatsForArchive([chat(), empty]).map((entry) => entry.name);
    expect(names).toEqual(["Переписка"]);
  });

  it("keeps a conversation that exists on the server even when empty", () => {
    // An empty chat on the server is still part of the account; dropping it would make the
    // archive quietly incomplete.
    const cloud = chat({ id: 2, name: "Облачный", messages: [], remoteId: "remote-1" });
    expect(chatsForArchive([cloud])).toHaveLength(1);
  });

  it("tells the three kinds of conversation apart", () => {
    const entries = chatsForArchive([
      chat({ id: 1, group: true }),
      chat({ id: 2, group: true, channel: true }),
      chat({ id: 3 }),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(["group", "channel", "chat"]);
  });

  it("marks a photo meant to be seen once", () => {
    const viewOnce = chat({
      messages: [
        {
          ...message(1, "фото"),
          attachment: { name: "a.jpg", type: "image/jpeg", size: 10, viewOnce: true },
        } as Message,
      ],
    });
    expect(chatsForArchive([viewOnce])[0].messages[0].viewOnce).toBe(true);
  });

  it("copies settings as they are instead of reinterpreting them", () => {
    // Settings now live in the account's namespace; the export reads that namespace.
    const store = scopedStore(ACCOUNT);
    store.write("nexus-theme", "dark");
    store.write("nexus-language", "ru");
    try {
      expect(settingsForArchive(ACCOUNT)).toEqual({ theme: "dark", language: "ru", wallpaper: null });
    } finally {
      window.localStorage.clear();
    }
  });

  it("exports the account's settings, not the browser's", () => {
    // A shared browser: a bare key left by an older build must not end up in an account's export.
    window.localStorage.setItem("nexus-theme", "light");
    scopedStore(ACCOUNT).write("nexus-theme", "dark");
    try {
      expect(settingsForArchive(ACCOUNT).theme).toBe("dark");
      expect(settingsForArchive(OTHER).theme).toBeNull();
    } finally {
      window.localStorage.clear();
    }
  });
});
