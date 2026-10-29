import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_SIZE, TEXT_SIZES, resolveTextSize, textScaleCss } from "./textSize";

describe("TEXT_SIZES", () => {
  it("offers three steps in increasing order", () => {
    expect(TEXT_SIZES).toHaveLength(3);
    const scales = TEXT_SIZES.map((s) => s.scale);
    expect(scales).toEqual([...scales].sort((a, b) => a - b));
  });

  it("contains an identity step, so the default changes nothing", () => {
    const middle = TEXT_SIZES.find((s) => s.id === DEFAULT_TEXT_SIZE);
    expect(middle?.scale).toBe(1);
  });

  it("keeps every step within a readable range", () => {
    for (const size of TEXT_SIZES) {
      expect(size.scale).toBeGreaterThanOrEqual(0.85);
      expect(size.scale).toBeLessThanOrEqual(1.25);
    }
  });
});

describe("resolveTextSize", () => {
  it("finds a known id", () => {
    expect(resolveTextSize("l").scale).toBe(1.15);
  });

  it("falls back to the default for anything unrecognised", () => {
    expect(resolveTextSize("huge").id).toBe(DEFAULT_TEXT_SIZE);
    expect(resolveTextSize(null).id).toBe(DEFAULT_TEXT_SIZE);
    expect(resolveTextSize(undefined).id).toBe(DEFAULT_TEXT_SIZE);
    expect(resolveTextSize("").id).toBe(DEFAULT_TEXT_SIZE);
  });
});

describe("textScaleCss", () => {
  it("emits a custom property ready to apply to the root", () => {
    expect(textScaleCss("s")).toBe("--text-scale: 0.9;");
    expect(textScaleCss("l")).toBe("--text-scale: 1.15;");
  });

  it("defaults safely", () => {
    expect(textScaleCss("nonsense")).toBe("--text-scale: 1;");
  });
});
