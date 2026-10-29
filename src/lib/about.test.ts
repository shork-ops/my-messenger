import { describe, expect, it } from "vitest";
import { ABOUT_MAX, aboutForCard, aboutRemaining, normalizeAbout, shouldShowAboutCounter } from "./about";

describe("normalizeAbout", () => {
  it("trims the whole value and each line", () => {
    expect(normalizeAbout("  привет  \n  мир  ")).toBe("привет\nмир");
  });

  it("drops leading and trailing blank lines", () => {
    expect(normalizeAbout("\n\nтекст\n\n")).toBe("текст");
  });

  it("collapses three or more newlines into one blank line", () => {
    expect(normalizeAbout("а\n\n\n\nб")).toBe("а\n\nб");
  });

  it("keeps a single blank line between paragraphs", () => {
    expect(normalizeAbout("первый\n\nвторой")).toBe("первый\n\nвторой");
  });

  it("handles Windows line endings", () => {
    expect(normalizeAbout("а\r\nб")).toBe("а\nб");
  });

  it("cuts at the limit instead of refusing the value", () => {
    const long = "я".repeat(200);
    expect(Array.from(normalizeAbout(long))).toHaveLength(ABOUT_MAX);
  });

  it("counts an emoji as one character, not two", () => {
    const value = "🙂".repeat(10);
    expect(Array.from(normalizeAbout(value))).toHaveLength(10);
    // And the same string survives a round trip, so nothing was cut in half.
    expect(normalizeAbout(value)).toBe(value);
  });

  it("turns an empty or whitespace value into an empty string", () => {
    expect(normalizeAbout("")).toBe("");
    expect(normalizeAbout("   \n\t ")).toBe("");
  });
});

describe("aboutRemaining", () => {
  it("counts down from the limit", () => {
    expect(aboutRemaining("")).toBe(ABOUT_MAX);
    expect(aboutRemaining("привет")).toBe(ABOUT_MAX - 6);
  });

  it("never goes negative", () => {
    expect(aboutRemaining("я".repeat(200))).toBe(0);
  });
});

describe("shouldShowAboutCounter", () => {
  it("stays quiet while there is room to spare", () => {
    expect(shouldShowAboutCounter("короткий текст")).toBe(false);
  });

  it("appears in the last thirty characters", () => {
    expect(shouldShowAboutCounter("я".repeat(ABOUT_MAX - 29))).toBe(true);
    expect(shouldShowAboutCounter("я".repeat(ABOUT_MAX))).toBe(true);
  });
});

describe("aboutForCard", () => {
  it("returns the cleaned value", () => {
    expect(aboutForCard("  строка  ")).toBe("строка");
  });

  it("returns null for nothing worth showing", () => {
    expect(aboutForCard("")).toBeNull();
    expect(aboutForCard("   ")).toBeNull();
    expect(aboutForCard(null)).toBeNull();
    expect(aboutForCard(undefined)).toBeNull();
  });
});
