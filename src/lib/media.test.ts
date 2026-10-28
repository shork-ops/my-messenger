import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_EDGE,
  buildStoragePath,
  fitDimensions,
  formatBytes,
  isCompressibleImage,
  isImage,
  isSupportedFile,
  shouldCompress,
} from "./media";

describe("fitDimensions", () => {
  it("keeps small images at their original size", () => {
    expect(fitDimensions(800, 600, MAX_IMAGE_EDGE)).toEqual({ width: 800, height: 600 });
  });

  it("scales the longest edge down and keeps the aspect ratio", () => {
    expect(fitDimensions(4000, 3000, MAX_IMAGE_EDGE)).toEqual({ width: 1920, height: 1440 });
  });

  it("handles portrait images", () => {
    expect(fitDimensions(3000, 4000, MAX_IMAGE_EDGE)).toEqual({ width: 1440, height: 1920 });
  });

  it("never produces a zero dimension", () => {
    expect(fitDimensions(10000, 1, MAX_IMAGE_EDGE)).toEqual({ width: 1920, height: 1 });
    expect(fitDimensions(0, 0, MAX_IMAGE_EDGE)).toEqual({ width: 1, height: 1 });
  });
});

describe("shouldCompress", () => {
  it("compresses large JPEG, PNG and WebP images", () => {
    expect(shouldCompress({ type: "image/jpeg", size: 2_000_000 })).toBe(true);
    expect(shouldCompress({ type: "image/png", size: 900_000 })).toBe(true);
    expect(shouldCompress({ type: "image/webp", size: 900_000 })).toBe(true);
  });

  it("leaves small images and non-images alone", () => {
    expect(shouldCompress({ type: "image/jpeg", size: 100_000 })).toBe(false);
    expect(shouldCompress({ type: "application/pdf", size: 5_000_000 })).toBe(false);
    // Animated GIFs would lose their animation through canvas re-encoding.
    expect(shouldCompress({ type: "image/gif", size: 5_000_000 })).toBe(false);
  });
});

describe("type checks", () => {
  it("recognises images and compressible formats", () => {
    expect(isImage("image/gif")).toBe(true);
    expect(isImage("video/mp4")).toBe(false);
    expect(isCompressibleImage("image/gif")).toBe(false);
    expect(isCompressibleImage("image/jpeg")).toBe(true);
  });

  it("accepts the supported file types and rejects the rest", () => {
    expect(isSupportedFile("application/pdf")).toBe(true);
    expect(isSupportedFile("text/csv")).toBe(true);
    expect(isSupportedFile("application/x-msdownload")).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats sizes for humans", () => {
    expect(formatBytes(0)).toBe("0 Б");
    expect(formatBytes(512)).toBe("512 Б");
    expect(formatBytes(2048)).toBe("2.0 КБ");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 МБ");
  });
});

describe("buildStoragePath", () => {
  it("namespaces by chat and sender", () => {
    expect(buildStoragePath("chat-1", "user-2", "photo.jpg", "abc")).toBe("chat-1/user-2/abc-photo.jpg");
  });

  it("strips characters that would break the path", () => {
    // Cyrillic (3) plus the space become four underscores before "файл".
    expect(buildStoragePath("c", "u", "мой файл (1).png", "id")).toBe("c/u/id-__________1_.png");
  });
});
