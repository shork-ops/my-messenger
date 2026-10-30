import { describe, expect, it } from "vitest";
import { cardImage, cardIsUsable, cardSite, firstLink, isSafeUrl, linkify, linkifySegments, type LinkCard } from "./links";

/**
 * Links in a message.
 *
 * Two jobs, and the second is the one that matters: showing a link as a link, and refusing to
 * show a link that would run code. A message body is attacker-controlled, so `javascript:`
 * and `data:` must never reach an href, and the test file says so explicitly.
 */

describe("isSafeUrl", () => {
  it("accepts http and https", () => {
    expect(isSafeUrl("https://example.com/a")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
  });

  it("refuses a javascript: scheme", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });

  it("refuses a data: URL", () => {
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("refuses a scheme disguised with whitespace or case", () => {
    // Browsers tolerate whitespace inside the scheme, so a naive check would pass.
    expect(isSafeUrl("  javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeUrl("java\nscript:alert(1)")).toBe(false);
  });

  it("refuses relative and empty values", () => {
    expect(isSafeUrl("/etc/passwd")).toBe(false);
    expect(isSafeUrl("example.com")).toBe(false);
    expect(isSafeUrl("")).toBe(false);
  });
});

describe("linkify", () => {
  it("finds an https URL", () => {
    expect(linkify("смотри https://example.com/a?b=1 тут")).toEqual([
      { kind: "text", text: "смотри " },
      { kind: "link", text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { kind: "text", text: " тут" },
    ]);
  });

  it("finds a bare domain without a scheme", () => {
    const parts = linkify("зайди на example.com пожалуйста");
    const link = parts.find((part) => part.kind === "link");
    expect(link?.kind === "link" && link.href).toBe("https://example.com");
  });

  it("does not link a plain word with a dot", () => {
    // "т.е." and "и т.д." are punctuation, not addresses.
    expect(linkify("и т.д. это так").some((part) => part.kind === "link")).toBe(false);
  });

  it("does not link the domain of an email address", () => {
    // An address is one token; half-linking it is worse than not linking it.
    const parts = linkify("пиши на qa@example.com");
    expect(parts.some((part) => part.kind === "link")).toBe(false);
  });

  it("strips trailing punctuation from the link", () => {
    const parts = linkify("открой https://example.com/a.");
    const link = parts.find((part) => part.kind === "link");
    expect(link?.kind === "link" && link.text).toBe("https://example.com/a");
  });

  it("leaves a javascript: URL as plain text", () => {
    const parts = linkify("javascript:alert(1)");
    expect(parts.every((part) => part.kind === "text")).toBe(true);
  });

  it("returns the whole message as text when there is no link", () => {
    expect(linkify("просто текст")).toEqual([{ kind: "text", text: "просто текст" }]);
  });

  it("handles several links in one message", () => {
    const parts = linkify("https://a.example.com и https://b.example.com");
    expect(parts.filter((part) => part.kind === "link")).toHaveLength(2);
  });
});

describe("firstLink", () => {
  it("returns the first address in the message", () => {
    expect(firstLink("смотри https://example.com и https://other.test")).toBe("https://example.com");
  });

  it("returns null when the message has none", () => {
    expect(firstLink("нет ссылок")).toBeNull();
  });

  it("ignores an unsafe address", () => {
    expect(firstLink("javascript:alert(1) https://safe.example.com")).toBe("https://safe.example.com");
  });
});

describe("linkifySegments", () => {
  it("keeps markup text and links apart so formatting still applies", () => {
    const segments = linkifySegments([{ kind: "text", text: "ссылка https://example.com" }]);
    expect(segments.some((segment) => segment.kind === "link")).toBe(true);
  });

  it("does not linkify inside code", () => {
    // A URL inside a code span is part of the code; turning it into a link would mean the
    // reader cannot copy what the author showed.
    const segments = linkifySegments([{ kind: "code", text: "curl https://example.com" }]);
    expect(segments.some((segment) => segment.kind === "link")).toBe(false);
  });
});

describe("link cards", () => {
  const card = (patch: Partial<LinkCard> = {}): LinkCard => ({
    url: "https://example.com/a",
    title: "Пример",
    description: "Описание",
    image: "https://example.com/og.png",
    site: "",
    ...patch,
  });

  it("needs a title or a description to be worth showing", () => {
    expect(cardIsUsable(card())).toBe(true);
    expect(cardIsUsable(card({ title: "", description: "только описание" }))).toBe(true);
    // A card with nothing but a URL is the same as the link already in the message.
    expect(cardIsUsable(card({ title: "", description: "" }))).toBe(false);
    expect(cardIsUsable(null)).toBe(false);
  });

  it("refuses a picture from a non-http source", () => {
    expect(cardImage(card())).toBe("https://example.com/og.png");
    expect(cardImage(card({ image: "javascript:alert(1)" }))).toBeNull();
    expect(cardImage(card({ image: "" }))).toBeNull();
  });

  it("falls back to the domain when the site has no name", () => {
    expect(cardSite(card({ site: "Пример.ру" }))).toBe("Пример.ру");
    expect(cardSite(card({ url: "https://www.example.com/a" }))).toBe("example.com");
  });

  it("survives a card whose url cannot be parsed", () => {
    expect(cardSite(card({ url: "не url", site: "" }))).toBe("");
  });
});
