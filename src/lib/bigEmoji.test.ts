import { describe, expect, it } from "vitest";
import { emojiOnlyCount } from "./bigEmoji";

describe("emojiOnlyCount", () => {
  it("counts one to three emoji, spaces between them allowed", () => {
    expect(emojiOnlyCount("👍")).toBe(1);
    expect(emojiOnlyCount("😂😂")).toBe(2);
    expect(emojiOnlyCount(" 🔥 ❤️ 🎉 ")).toBe(3);
  });

  it("treats joined, toned and flag emoji as one each", () => {
    expect(emojiOnlyCount("👨‍👩‍👧")).toBe(1);
    expect(emojiOnlyCount("👍🏽")).toBe(1);
    expect(emojiOnlyCount("🇷🇺")).toBe(1);
    expect(emojiOnlyCount("❤️‍🔥")).toBe(1);
    expect(emojiOnlyCount("1️⃣")).toBe(1);
  });

  it("is ordinary text with a fourth emoji, a letter, a digit or punctuation", () => {
    expect(emojiOnlyCount("😀😀😀😀")).toBe(0);
    expect(emojiOnlyCount("ок 👍")).toBe(0);
    expect(emojiOnlyCount("👍!")).toBe(0);
    expect(emojiOnlyCount("5")).toBe(0);
    expect(emojiOnlyCount("||😀||")).toBe(0);
    expect(emojiOnlyCount("")).toBe(0);
    expect(emojiOnlyCount("   ")).toBe(0);
    expect(emojiOnlyCount("Привет")).toBe(0);
  });
});
