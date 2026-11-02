import { describe, expect, it } from "vitest";
import { AVATAR_TONES, avatarTone } from "./avatarTone";

describe("avatarTone", () => {
  it("gives the same colour for the same seed", () => {
    expect(avatarTone("c1d2e3f4-0000-4000-8000-000000000001")).toBe(avatarTone("c1d2e3f4-0000-4000-8000-000000000001"));
    expect(avatarTone("Аня")).toBe(avatarTone("Аня"));
  });

  it("always answers with a colour from the palette, even for an empty seed", () => {
    for (const seed of ["", "a", "Максим", "👥", "x".repeat(500)]) expect(AVATAR_TONES).toContain(avatarTone(seed));
  });

  it("spreads people across the palette instead of painting them one colour", () => {
    const seen = new Set(Array.from({ length: 60 }, (_, index) => avatarTone(`user-${index}`)));
    expect(seen.size).toBe(AVATAR_TONES.length);
  });
});
