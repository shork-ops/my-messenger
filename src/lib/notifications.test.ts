import { describe, expect, it } from "vitest";
import { badgeCount, badgeText, formatDocumentTitle } from "./notifications";

describe("formatDocumentTitle", () => {
  it("leads with the count when there is something to read", () => {
    expect(formatDocumentTitle(3)).toBe("(3) Nexus");
  });

  it("shows only the name when everything is read", () => {
    expect(formatDocumentTitle(0)).toBe("Nexus");
  });

  it("accepts another app name", () => {
    expect(formatDocumentTitle(1, "Чат")).toBe("(1) Чат");
  });
});

describe("badgeCount", () => {
  it("clamps to what the Badging API accepts", () => {
    expect(badgeCount(5)).toBe(5);
    expect(badgeCount(0)).toBe(0);
    expect(badgeCount(150)).toBe(99);
  });

  it("never goes negative", () => {
    expect(badgeCount(-2)).toBe(0);
  });
});

describe("badgeText", () => {
  it("shows nothing for zero", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(-3)).toBe("");
  });

  it("shows the number up to ninety-nine", () => {
    expect(badgeText(1)).toBe("1");
    expect(badgeText(99)).toBe("99");
  });

  it("collapses anything larger, because the exact number stops mattering", () => {
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(1234)).toBe("99+");
  });
});
