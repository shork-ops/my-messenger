import { describe, expect, it } from "vitest";
import { ALL_EMOJI, EMOJI, isEmojiEmpty, searchEmoji } from "./emoji";

describe("EMOJI", () => {
  it("has a reasonable catalogue", () => {
    expect(EMOJI.length).toBeGreaterThan(40);
  });

  it("has no duplicate characters", () => {
    expect(new Set(ALL_EMOJI).size).toBe(ALL_EMOJI.length);
  });

  it("gives every entry words in both languages", () => {
    for (const entry of EMOJI) {
      expect(entry.words.length).toBeGreaterThan(5);
      // Cyrillic and Latin both present, so the same search works either way.
      expect(entry.words).toMatch(/[а-яё]/);
      expect(entry.words).toMatch(/[a-z]/);
    }
  });

  it("keeps multi-byte emoji intact", () => {
    for (const entry of EMOJI) {
      // A lone surrogate means a character was sliced in half.
      expect(entry.char).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });
});

describe("searchEmoji", () => {
  it("returns the whole catalogue for an empty query", () => {
    expect(searchEmoji("").length).toBe(EMOJI.length);
    expect(searchEmoji("   ").length).toBe(EMOJI.length);
  });

  it("finds an emoji by a Russian word", () => {
    const found = searchEmoji("обнять").map((entry) => entry.char);
    expect(found).toContain("🤗");
  });

  it("finds the same emoji by its English word", () => {
    expect(searchEmoji("hug").map((entry) => entry.char)).toContain("🤗");
  });

  it("matches a word prefix, so typing is incremental", () => {
    const found = searchEmoji("серд").map((entry) => entry.char);
    expect(found).toContain("❤️");
  });

  it("ignores case", () => {
    expect(searchEmoji("КОТ").map((entry) => entry.char)).toEqual(searchEmoji("кот").map((entry) => entry.char));
  });

  it("matches a whole word, not a fragment in the middle", () => {
    // "об" is a prefix of "обнять" and should match; "бн" is in no word's start.
    expect(searchEmoji("об").length).toBeGreaterThan(0);
    expect(searchEmoji("бн").length).toBe(0);
  });

  it("returns nothing for nonsense rather than everything", () => {
    expect(searchEmoji("ыыыы").length).toBe(0);
  });

  it("respects the limit on a search", () => {
    expect(searchEmoji("серд", 2).length).toBe(2);
    expect(searchEmoji("а", 3).length).toBeLessThanOrEqual(3);
  });

  it("finds several results for a broad word", () => {
    expect(searchEmoji("сердце").length).toBeGreaterThanOrEqual(2);
  });
});

describe("isEmojiEmpty", () => {
  it("is true only when nothing matched", () => {
    expect(isEmojiEmpty("ыыыы")).toBe(true);
    expect(isEmojiEmpty("кот")).toBe(false);
    expect(isEmojiEmpty("")).toBe(false);
  });
});
