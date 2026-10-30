import { describe, expect, it } from "vitest";
import { DEFAULT_PRIVACY, parsePrivacy, receiptVisible, seenVisible, serializePrivacy } from "./privacyPrefs";

/**
 * What other people are allowed to learn about the reader.
 *
 * These are reads, not writes: hiding receipts or the last-seen time changes what this
 * browser shows about *it*, and the other side learns nothing extra.
 */

describe("defaults", () => {
  it("shows receipts and the last-seen time until told otherwise", () => {
    expect(DEFAULT_PRIVACY.readReceipts).toBe(true);
    expect(DEFAULT_PRIVACY.lastSeen).toBe(true);
    expect(DEFAULT_PRIVACY.typingIndicator).toBe(true);
  });
});

describe("parsePrivacy", () => {
  it("returns the defaults for missing or broken storage", () => {
    expect(parsePrivacy(null)).toEqual(DEFAULT_PRIVACY);
    expect(parsePrivacy("")).toEqual(DEFAULT_PRIVACY);
    expect(parsePrivacy("не json")).toEqual(DEFAULT_PRIVACY);
    expect(parsePrivacy("[]")).toEqual(DEFAULT_PRIVACY);
  });

  it("reads a stored value", () => {
    expect(parsePrivacy('{"readReceipts":false,"lastSeen":false,"typingIndicator":true}')).toEqual({
      readReceipts: false,
      lastSeen: false,
      typingIndicator: true,
    });
  });

  it("fills a missing field from the defaults instead of guessing", () => {
    // An old build stored only receipts; the other two must not become undefined.
    expect(parsePrivacy('{"readReceipts":false}')).toEqual({ ...DEFAULT_PRIVACY, readReceipts: false });
  });

  it("ignores fields that are not booleans", () => {
    expect(parsePrivacy('{"readReceipts":"нет","lastSeen":1}')).toEqual(DEFAULT_PRIVACY);
  });
});

describe("serializePrivacy", () => {
  it("round-trips", () => {
    const prefs = { readReceipts: false, lastSeen: false, typingIndicator: false };
    expect(parsePrivacy(serializePrivacy(prefs))).toEqual(prefs);
  });
});

describe("receiptVisible", () => {
  it("stays silent when receipts are switched off, even for a read message", () => {
    expect(receiptVisible("read", false)).toBeNull();
    expect(receiptVisible("sent", false)).toBeNull();
  });

  it("shows the real state when receipts are on", () => {
    expect(receiptVisible("read", true)).toBe("read");
    expect(receiptVisible("sent", true)).toBe("sent");
    expect(receiptVisible(null, true)).toBeNull();
  });
});

describe("seenVisible", () => {
  it("hides the last-seen line when switched off", () => {
    expect(seenVisible("был(а) 5 минут назад", false)).toBeNull();
  });

  it("passes it through when on", () => {
    expect(seenVisible("был(а) 5 минут назад", true)).toBe("был(а) 5 минут назад");
  });
});
