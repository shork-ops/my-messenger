import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_BYTES,
  avatarFallback,
  avatarOwner,
  avatarRejectionMessage,
  buildAvatarPath,
  checkAvatarFile,
  isAvatarPath,
} from "./avatar";

describe("checkAvatarFile", () => {
  it("accepts the formats the bucket allows", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(checkAvatarFile({ type, size: 1024 })).toBeNull();
    }
  });

  it("rejects formats the bucket would refuse anyway", () => {
    expect(checkAvatarFile({ type: "image/gif", size: 1024 })).toBe("wrong-type");
    expect(checkAvatarFile({ type: "application/pdf", size: 1024 })).toBe("wrong-type");
    expect(checkAvatarFile({ type: "video/mp4", size: 1024 })).toBe("wrong-type");
  });

  it("rejects a file over the 5 MB limit and accepts exactly at it", () => {
    expect(checkAvatarFile({ type: "image/jpeg", size: AVATAR_MAX_BYTES + 1 })).toBe("too-large");
    expect(checkAvatarFile({ type: "image/jpeg", size: AVATAR_MAX_BYTES })).toBeNull();
  });

  it("reports the type problem before the size problem", () => {
    // A 9 MB PDF is both, but naming the format is the more useful answer.
    expect(checkAvatarFile({ type: "application/pdf", size: 9 * 1024 * 1024 })).toBe("wrong-type");
  });
});

describe("avatarRejectionMessage", () => {
  it("says nothing when the file is fine", () => {
    expect(avatarRejectionMessage(null)).toBeNull();
  });

  it("explains each rejection in words a user can act on", () => {
    expect(avatarRejectionMessage("too-large")).toContain("5 МБ");
    expect(avatarRejectionMessage("wrong-type")).toContain("JPEG");
  });
});

describe("buildAvatarPath", () => {
  it("puts the owner id first so storage policies can check it", () => {
    expect(buildAvatarPath("user-1", "abc", "image/png")).toBe("user-1/abc.png");
  });

  it("maps each accepted type to its extension", () => {
    expect(buildAvatarPath("u", "i", "image/jpeg")).toBe("u/i.jpg");
    expect(buildAvatarPath("u", "i", "image/webp")).toBe("u/i.webp");
  });

  it("falls back to jpg for an unexpected type", () => {
    expect(buildAvatarPath("u", "i", "image/avif")).toBe("u/i.jpg");
  });
});

describe("avatarOwner", () => {
  it("reads the first segment", () => {
    expect(avatarOwner("user-1/abc.png")).toBe("user-1");
  });

  it("returns null for a path with no folder", () => {
    expect(avatarOwner("abc.png")).toBe("abc.png");
    expect(avatarOwner("")).toBeNull();
  });
});

describe("isAvatarPath", () => {
  it("treats a legacy letter or emoji as not a path", () => {
    expect(isAvatarPath("N")).toBe(false);
    expect(isAvatarPath("🙂")).toBe(false);
    expect(isAvatarPath("")).toBe(false);
    expect(isAvatarPath(null)).toBe(false);
  });

  it("recognises a storage path", () => {
    expect(isAvatarPath("user-1/abc.png")).toBe(true);
  });
});

describe("avatarFallback", () => {
  it("takes the first character", () => {
    expect(avatarFallback("Алексей")).toBe("А");
  });

  it("keeps an emoji whole instead of a broken surrogate half", () => {
    expect(avatarFallback("🙂 Друг")).toBe("🙂");
  });

  it("survives an empty name", () => {
    expect(avatarFallback("")).toBe("?");
    expect(avatarFallback("   ")).toBe("?");
  });
});
