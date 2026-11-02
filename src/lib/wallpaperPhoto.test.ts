import { describe, expect, it } from "vitest";
import { WALLPAPER_MAX_SIDE, fitWithin } from "./wallpaperPhoto";

describe("fitting a wallpaper photo", () => {
  it("scales a large phone photo down to the longest side", () => {
    expect(fitWithin(3024, 4032, WALLPAPER_MAX_SIDE)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 });
  });

  it("never enlarges a small picture", () => {
    expect(fitWithin(800, 600, WALLPAPER_MAX_SIDE)).toEqual({ width: 800, height: 600 });
  });

  it("refuses a picture with no size", () => {
    expect(fitWithin(0, 600, 1600)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Number.NaN, 600, 1600)).toEqual({ width: 0, height: 0 });
  });
});
