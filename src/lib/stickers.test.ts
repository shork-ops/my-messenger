import { describe, expect, it } from "vitest";
import { STICKERS, isSticker, searchStickers, stickerById, stickerMarkup, stickerPack, stickerFromBody } from "./stickers";

/**
 * Stickers are a way of talking, not decoration.
 *
 * The set is small and hand-written rather than a downloaded pack: a sticker that depends
 * on a third-party image host breaks when that host does, and the whole point of a messenger
 * for close people is that the pictures still work in five years.
 */

describe("STICKERS", () => {
  it("offers a usable set", () => {
    expect(STICKERS.length).toBeGreaterThanOrEqual(24);
  });

  it("gives every sticker a unique id", () => {
    const ids = STICKERS.map((sticker) => sticker.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every sticker words to search by, in Russian", () => {
    for (const sticker of STICKERS) {
      expect(sticker.words.length).toBeGreaterThan(0);
      expect(sticker.words.join(" ")).toMatch(/[а-яА-Я]/);
    }
  });

  it("has no empty artwork", () => {
    for (const sticker of STICKERS) {
      expect(sticker.glyph.length).toBeGreaterThan(0);
    }
  });
});

describe("stickerById", () => {
  it("finds a sticker", () => {
    expect(stickerById(STICKERS[0].id)?.id).toBe(STICKERS[0].id);
  });

  it("returns undefined for an unknown id instead of throwing", () => {
    // A message from a newer build may reference a sticker this build does not have.
    expect(stickerById("нет-такого")).toBeUndefined();
  });
});

describe("isSticker", () => {
  it("accepts a known id", () => {
    expect(isSticker(STICKERS[2].id)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isSticker("нет-такого")).toBe(false);
    expect(isSticker("")).toBe(false);
  });
});

describe("searchStickers", () => {
  it("returns everything for an empty query", () => {
    expect(searchStickers("")).toEqual(STICKERS);
    expect(searchStickers("   ")).toEqual(STICKERS);
  });

  it("finds by a Russian word", () => {
    const found = searchStickers("привет");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((sticker) => sticker.words.some((word) => word.startsWith("привет")))).toBe(true);
  });

  it("ignores case", () => {
    expect(searchStickers("ПРИВЕТ")).toEqual(searchStickers("привет"));
  });

  it("finds nothing rather than everything when the word is unknown", () => {
    expect(searchStickers("квантовая хромодинамика")).toEqual([]);
  });
});

describe("stickerPack", () => {
  it("names the pack and lists it in order", () => {
    const pack = stickerPack();
    expect(pack.name.length).toBeGreaterThan(0);
    expect(pack.stickers).toEqual(STICKERS);
  });
});

describe("sticker body", () => {
  it("round-trips through the message body", () => {
    expect(stickerFromBody(stickerMarkup("hug"))).toBe("hug");
  });

  it("leaves ordinary text alone", () => {
    expect(stickerFromBody("привет, как дела?")).toBeNull();
    expect(stickerFromBody("")).toBeNull();
  });

  it("does not mistake text that merely mentions a sticker for one", () => {
    // The marker is a control character: nobody types it, and a message that quoted it
    // would still be a message.
    expect(stickerFromBody("посмотри на \u0001sticker")).toBeNull();
  });

  it("rejects an empty id", () => {
    expect(stickerFromBody(stickerMarkup(""))).toBeNull();
    expect(stickerFromBody(stickerMarkup("   "))).toBeNull();
  });
});
