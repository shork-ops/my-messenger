import { describe, expect, it } from "vitest";
import { EFFECTS, effectByKey, effectKeys } from "./effects";

/**
 * Message effects.
 *
 * The comparison found effects in only three of the nine messengers examined, which makes
 * this a reason to have them rather than to drop them. Expanding the set is only worth it if
 * every effect stays distinguishable at a glance and the code stops repeating itself.
 */

describe("EFFECTS", () => {
  it("offers more than the original four", () => {
    expect(EFFECTS.length).toBeGreaterThan(4);
  });

  it("gives every effect a symbol and a Russian name", () => {
    for (const effect of EFFECTS) {
      expect(effect.symbol.length).toBeGreaterThan(0);
      expect(effect.label.length).toBeGreaterThan(0);
      expect(effect.description).toMatch(/[а-яА-Я]/);
    }
  });

  it("uses a different symbol for each effect", () => {
    // Two effects that look identical would be one effect with a longer menu.
    const symbols = EFFECTS.map((effect) => effect.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("uses a different key for each effect", () => {
    const keys = EFFECTS.map((effect) => effect.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the original four keys, so stored messages still render", () => {
    const keys = EFFECTS.map((effect) => effect.key);
    for (const original of ["sparkle", "hearts", "fireworks", "glow"]) {
      expect(keys).toContain(original);
    }
  });
});

describe("effectByKey", () => {
  it("finds an effect by key", () => {
    expect(effectByKey("hearts")?.label).toContain("сердечк");
  });

  it("returns undefined for an unknown key instead of guessing", () => {
    // A message saved by a newer build may carry an effect this build does not know.
    expect(effectByKey("teleport")).toBeUndefined();
  });
});

describe("effectKeys", () => {
  it("is the list of keys, in display order", () => {
    expect(effectKeys()).toEqual(EFFECTS.map((effect) => effect.key));
  });
});
