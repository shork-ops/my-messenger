import { describe, expect, it } from "vitest";
import { CACHE_KEYS, formatBytes, mediaBytes, plural, presentCacheKeys, storageSummary } from "./storageUsage";

describe("mediaBytes", () => {
  it("adds the sizes of attachments", () => {
    expect(mediaBytes([{ attachment: { size: 100 } }, { attachment: { size: 250 } }])).toBe(350);
  });

  it("ignores messages without attachments", () => {
    expect(mediaBytes([{ attachment: null }, {}, { attachment: { size: 10 } }])).toBe(10);
  });

  it("ignores attachments without a recorded size", () => {
    expect(mediaBytes([{ attachment: {} }])).toBe(0);
  });

  it("is zero for an empty list", () => {
    expect(mediaBytes([])).toBe(0);
  });
});

describe("formatBytes", () => {
  it("says zero plainly", () => {
    expect(formatBytes(0)).toBe("0 Б");
    expect(formatBytes(-5)).toBe("0 Б");
    expect(formatBytes(Number.NaN)).toBe("0 Б");
  });

  it("uses bytes below a kilobyte", () => {
    expect(formatBytes(512)).toBe("512 Б");
  });

  it("uses kilobytes below a megabyte", () => {
    expect(formatBytes(2048)).toBe("2.0 КБ");
  });

  it("uses megabytes below a gigabyte", () => {
    expect(formatBytes(1024 ** 2)).toBe("1.0 МБ");
  });

  it("uses gigabytes above", () => {
    expect(formatBytes(1024 ** 3 * 2)).toBe("2.0 ГБ");
  });

  it("keeps one decimal below ten and none above", () => {
    // "1.4 МБ" tells you something; "14 МБ" is noise.
    expect(formatBytes(1.4 * 1024 ** 2)).toBe("1.4 МБ");
    expect(formatBytes(13.7 * 1024 ** 2)).toBe("14 МБ");
  });
});

describe("plural", () => {
  it("picks the singular form for one", () => {
    expect(plural(1, "вложение", "вложения", "вложений")).toBe("вложение");
    expect(plural(21, "вложение", "вложения", "вложений")).toBe("вложение");
  });

  it("picks the few form for two to four", () => {
    expect(plural(2, "вложение", "вложения", "вложений")).toBe("вложения");
    expect(plural(24, "вложение", "вложения", "вложений")).toBe("вложения");
  });

  it("picks the many form for five and up", () => {
    expect(plural(5, "вложение", "вложения", "вложений")).toBe("вложений");
    expect(plural(100, "вложение", "вложения", "вложений")).toBe("вложений");
  });

  it("treats eleven to fourteen as many, which is the case everyone gets wrong", () => {
    expect(plural(11, "вложение", "вложения", "вложений")).toBe("вложений");
    expect(plural(12, "вложение", "вложения", "вложений")).toBe("вложений");
    expect(plural(14, "вложение", "вложения", "вложений")).toBe("вложений");
  });
});

describe("presentCacheKeys", () => {
  it("returns only keys that exist", () => {
    const existing = new Set(["nexus-theme", "nexus-language"]);
    expect(presentCacheKeys(CACHE_KEYS, (key) => existing.has(key))).toEqual(["nexus-theme", "nexus-language"]);
  });

  it("returns nothing when the store is empty", () => {
    expect(presentCacheKeys(CACHE_KEYS, () => false)).toEqual([]);
  });

  it("lists the keys this app owns", () => {
    expect(CACHE_KEYS).toContain("nexus-theme");
    expect(CACHE_KEYS).toContain("nexus-notification-prefs");
  });
});

describe("storageSummary", () => {
  it("says plainly when there is nothing", () => {
    expect(storageSummary(0, 0)).toBe("Вложений пока нет");
  });

  it("counts attachments with the right plural", () => {
    expect(storageSummary(2048, 1)).toBe("2.0 КБ в 1 вложении");
    expect(storageSummary(2048, 3)).toBe("2.0 КБ в 3 вложениях");
    expect(storageSummary(2048, 11)).toBe("2.0 КБ в 11 вложениях");
  });
});
