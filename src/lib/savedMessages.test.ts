import { describe, expect, it } from "vitest";
import { isMissingSavedTable, mergeFavourites, savedRowToMessage, storableAttachment } from "./savedMessages";
import { createFavouritesChat } from "./messageActions";
import type { Message } from "../types";

const row = {
  id: "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9",
  author: "Мария",
  body: "Купить билеты",
  attachment: null,
  created_at: "2026-11-02T08:00:00.000Z",
};

describe("savedRowToMessage", () => {
  it("turns a saved row into a message of the favourites chat", () => {
    const message = savedRowToMessage(row, "Валентина");
    expect(message.savedId).toBe(row.id);
    expect(message.author).toBe("Мария");
    expect(message.text).toBe("Купить билеты");
    expect(message.mine).toBe(true);
    expect(message.createdAt).toBe(Date.parse(row.created_at));
    expect(message.replyTo).toEqual({ author: "Мария", text: "Купить билеты" });
    expect(message.attachment).toBeUndefined();
  });

  it("shows one's own message and a note to oneself without a quote", () => {
    expect(savedRowToMessage({ ...row, author: "Валентина" }, "Валентина").replyTo).toBeUndefined();
  });

  it("gives an attachment a fresh link and its expiry", () => {
    const message = savedRowToMessage(
      { ...row, attachment: { name: "photo.jpg", type: "image/jpeg", size: 10, path: "chat/u/photo.jpg" } },
      "Валентина",
      "https://signed",
      123
    );
    expect(message.attachment).toMatchObject({ name: "photo.jpg", path: "chat/u/photo.jpg", data: "https://signed", expiresAt: 123 });
  });
});

describe("storableAttachment", () => {
  const photo = { name: "photo.jpg", type: "image/jpeg", size: 10, data: "https://signed", path: "chat/u/photo.jpg", expiresAt: 5, thumbnail: "data:x" };

  it("keeps the file's place and description, never the lapsing link", () => {
    expect(storableAttachment(photo)).toEqual({ name: "photo.jpg", type: "image/jpeg", size: 10, path: "chat/u/photo.jpg", thumbnail: "data:x" });
  });

  it("keeps nothing for a view-once photo, a file never uploaded, or no file", () => {
    expect(storableAttachment({ ...photo, viewOnce: true })).toBeNull();
    expect(storableAttachment({ ...photo, path: undefined })).toBeNull();
    expect(storableAttachment(undefined)).toBeNull();
  });

  it("drops a preview too big for the column", () => {
    const stored = storableAttachment({ ...photo, thumbnail: "x".repeat(40_000) });
    expect(stored).toEqual({ name: "photo.jpg", type: "image/jpeg", size: 10, path: "chat/u/photo.jpg" });
  });
});

describe("mergeFavourites", () => {
  const cloud = [savedRowToMessage(row, "Валентина")];
  const local = (messages: Message[]) => ({ ...createFavouritesChat(), messages });

  it("is nothing when there are no favourites anywhere", () => {
    expect(mergeFavourites(null, undefined)).toBeNull();
    expect(mergeFavourites([], undefined)).toBeNull();
  });

  it("shows the server's favourites after a reload", () => {
    const chat = mergeFavourites(cloud, undefined);
    expect(chat?.messages.map((message) => message.text)).toEqual(["Купить билеты"]);
    expect(chat?.preview).toBe("Купить билеты");
  });

  it("keeps a message still being saved and orders by time", () => {
    const pending: Message = { id: 7, author: "Вы", text: "Заметка", time: "", mine: true, createdAt: Date.parse(row.created_at) + 120_000 };
    const chat = mergeFavourites(cloud, local([pending]));
    expect(chat?.messages.map((message) => message.text)).toEqual(["Купить билеты", "Заметка"]);
  });

  it("does not show twice a message the server already has", () => {
    const sameAsRow: Message = { id: 7, author: "Мария", text: "Купить билеты", time: "", mine: true, createdAt: Date.parse(row.created_at) + 2_000 };
    expect(mergeFavourites(cloud, local([sameAsRow]))?.messages).toHaveLength(1);
  });

  it("drops a saved message removed on another device and keeps the local chat when the server is silent", () => {
    const removedElsewhere: Message = { ...savedRowToMessage(row, "Валентина"), savedId: "gone", id: 9, text: "Старое" };
    expect(mergeFavourites(cloud, local([removedElsewhere]))?.messages.map((message) => message.text)).toEqual(["Купить билеты"]);
    expect(mergeFavourites(null, local([removedElsewhere]))?.messages).toHaveLength(1);
  });
});

describe("isMissingSavedTable", () => {
  it("recognises a server without the migration", () => {
    expect(isMissingSavedTable({ code: "PGRST205", message: "Could not find the table 'public.saved_messages'" })).toBe(true);
    expect(isMissingSavedTable({ code: "42P01" })).toBe(true);
    expect(isMissingSavedTable({ code: "23514", message: "violates check constraint" })).toBe(false);
    expect(isMissingSavedTable(null)).toBe(false);
  });
});
