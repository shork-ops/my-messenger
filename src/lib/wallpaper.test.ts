import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALLPAPER,
  WALLPAPERS,
  WALLPAPER_STORAGE_KEY,
  parseWallpaper,
  wallpaperBackground,
  wallpaperOpacity,
  wallpaperSize,
} from "./wallpaper";

describe("WALLPAPERS", () => {
  it("offers a plain option plus patterns", () => {
    expect(WALLPAPERS[0].id).toBe("none");
    expect(WALLPAPERS.length).toBeGreaterThan(3);
  });

  it("has unique ids", () => {
    const ids = WALLPAPERS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every option a label and a hint", () => {
    for (const item of WALLPAPERS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("parseWallpaper", () => {
  it("keeps a known choice", () => {
    expect(parseWallpaper("grid")).toBe("grid");
  });

  it("falls back to plain for anything else", () => {
    expect(parseWallpaper(null)).toBe(DEFAULT_WALLPAPER);
    expect(parseWallpaper("")).toBe(DEFAULT_WALLPAPER);
    expect(parseWallpaper("photo.jpg")).toBe(DEFAULT_WALLPAPER);
  });
});

describe("wallpaperBackground", () => {
  const accent = "rgba(255,255,255,0.5)";

  it("draws nothing for the plain option", () => {
    expect(wallpaperBackground("none", accent)).toBe("none");
  });

  it("uses the accent colour it is given, not a hard-coded one", () => {
    const red = "rgba(255,0,0,0.5)";
    expect(wallpaperBackground("dots", red)).toContain(red);
    expect(wallpaperBackground("dots", red)).not.toContain("255,255,255");
  });

  it("produces a css value for each pattern", () => {
    for (const item of WALLPAPERS) {
      const value = wallpaperBackground(item.id, accent);
      expect(value.length).toBeGreaterThan(2);
      if (item.id !== "none") expect(value).toContain("gradient");
    }
  });

  it("distinguishes the patterns from one another", () => {
    const values = new Set(WALLPAPERS.map((item) => wallpaperBackground(item.id, accent)));
    expect(values.size).toBe(WALLPAPERS.length);
  });

  // A position and a size folded into background-image make the browser drop the
  // whole declaration, so they are asserted to be absent.
  it("keeps tile geometry out of the image value", () => {
    for (const item of WALLPAPERS) {
      const value = wallpaperBackground(item.id, accent);
      expect(value).not.toContain(" / ");
      // A tile step is always two equal values; a colour stop is a single one.
      expect(value).not.toMatch(/\b(\d+)px \1px/);
    }
  });
});

describe("wallpaperSize", () => {
  it("tiles the repeating patterns at their own step", () => {
    expect(wallpaperSize("dots")).toBe("18px 18px");
    expect(wallpaperSize("grid")).toBe("26px 26px");
  });

  it("leaves gradients that carry their own spacing alone", () => {
    expect(wallpaperSize("diagonal")).toBe("auto");
    expect(wallpaperSize("waves")).toBe("auto");
    expect(wallpaperSize("none")).toBe("auto");
  });
});

describe("wallpaperOpacity", () => {
  it("is zero when there is no wallpaper", () => {
    expect(wallpaperOpacity("none", "yellow")).toBe(0);
    expect(wallpaperOpacity("none", "light")).toBe(0);
  });

  it("is lower in the light theme, where text has less room", () => {
    expect(wallpaperOpacity("grid", "light")).toBeLessThan(wallpaperOpacity("grid", "yellow"));
  });

  it("never reaches a strength that would fight the messages", () => {
    for (const item of WALLPAPERS) {
      expect(wallpaperOpacity(item.id, "yellow")).toBeLessThan(0.15);
      expect(wallpaperOpacity(item.id, "light")).toBeLessThan(0.15);
    }
  });
});

describe("WALLPAPER_STORAGE_KEY", () => {
  it("is a nexus key, so clear-cache owns it", () => {
    expect(WALLPAPER_STORAGE_KEY).toBe("nexus-wallpaper");
  });
});
