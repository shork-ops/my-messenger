import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT,
  channelAccent,
  channelSubtitle,
  canPostToChannel,
  isChannelRole,
  parseChannelDesign,
  parseAccent,
  serializeChannelDesign,
} from "./channels";

/**
 * Channels.
 *
 * A channel is not a chat with a setting flipped: the reader's whole expectation changes.
 * Someone who subscribes to a channel is not waiting for a reply, so seeing "печатает…" or a
 * composer that refuses them is a different product. These functions hold that difference in
 * one place, so the composer, the header and the list cannot disagree about it.
 */

describe("canPostToChannel", () => {
  it("lets the owner and authors post", () => {
    expect(canPostToChannel("owner")).toBe(true);
    expect(canPostToChannel("author")).toBe(true);
  });

  it("does not let a plain subscriber post", () => {
    expect(canPostToChannel("subscriber")).toBe(false);
  });

  it("treats an unknown role as a reader", () => {
    // Failing open here would let anyone post in any channel.
    expect(canPostToChannel(null)).toBe(false);
    expect(canPostToChannel(undefined)).toBe(false);
    expect(canPostToChannel("")).toBe(false);
  });
});

describe("isChannelRole", () => {
  it("accepts the three known roles", () => {
    expect(isChannelRole("owner")).toBe(true);
    expect(isChannelRole("author")).toBe(true);
    expect(isChannelRole("subscriber")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isChannelRole("admin")).toBe(false);
    expect(isChannelRole(null)).toBe(false);
  });
});

describe("channelSubtitle", () => {
  it("counts subscribers in words that make sense for one and for many", () => {
    expect(channelSubtitle(1, 0)).toBe("1 подписчик");
    expect(channelSubtitle(3, 0)).toBe("3 подписчика");
    expect(channelSubtitle(11, 0)).toBe("11 подписчиков");
    expect(channelSubtitle(21, 0)).toBe("21 подписчик");
  });

  it("falls back to the description when there is one", () => {
    expect(channelSubtitle(50, 0, "о путешествиях")).toBe("о путешествиях");
  });

  it("says nothing rather than «0 подписчиков» when the count is unknown", () => {
    expect(channelSubtitle(0, 0)).toBe("");
  });
});

describe("parseAccent", () => {
  it("accepts a six-digit hex colour", () => {
    expect(parseAccent("#f0b429")).toBe("#f0b429");
  });

  it("refuses anything that could break out of a style value", () => {
    // This value goes into a CSS custom property, so "valid colour" is a security rule too.
    expect(parseAccent("red; background: url(//evil)")).toBeNull();
    expect(parseAccent("url(javascript:alert(1))")).toBeNull();
    expect(parseAccent("#12345")).toBeNull();
    expect(parseAccent("")).toBeNull();
    expect(parseAccent(null)).toBeNull();
  });
});

describe("channelAccent", () => {
  it("uses the channel colour when it has one", () => {
    expect(channelAccent("#2f6fed")).toBe("#2f6fed");
  });

  it("falls back to the app's own accent", () => {
    expect(channelAccent(null)).toBe(DEFAULT_ACCENT);
    expect(channelAccent("не цвет")).toBe(DEFAULT_ACCENT);
  });
});

describe("parseChannelDesign", () => {
  it("reads a stored design", () => {
    const design = parseChannelDesign('{"accent":"#2f6fed","cover":"https://x/y.png","pinned":42}');
    expect(design.accent).toBe("#2f6fed");
    expect(design.cover).toBe("https://x/y.png");
    expect(design.pinned).toBe(42);
  });

  it("refuses a cover that is not an http address", () => {
    // The cover is an image URL from a user, loaded into the header of everyone who looks.
    expect(parseChannelDesign('{"cover":"javascript:alert(1)"}').cover).toBeNull();
    expect(parseChannelDesign('{"cover":"data:text/html,x"}').cover).toBeNull();
  });

  it("survives broken json", () => {
    expect(parseChannelDesign("{не json").accent).toBeNull();
    expect(parseChannelDesign(null).cover).toBeNull();
  });
});

describe("serializeChannelDesign", () => {
  it("round-trips", () => {
    const design = { accent: "#2f6fed", cover: null, pinned: null };
    expect(parseChannelDesign(serializeChannelDesign(design)).accent).toBe("#2f6fed");
  });

  it("drops an unsafe accent instead of storing it", () => {
    expect(serializeChannelDesign({ accent: "red;x", cover: null, pinned: null })).not.toContain("red;x");
  });
});
