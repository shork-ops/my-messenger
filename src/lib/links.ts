import type { MarkupSegment } from "./markup";

/**
 * Links inside a message.
 *
 * A message body is written by someone else, so every URL here is untrusted input. Two rules
 * follow from that and are the reason this is a hand-written matcher rather than a regex
 * found online:
 *
 * 1. Only `http` and `https` ever become an `href`. `javascript:` and `data:` do not, and the
 *    check tolerates the whitespace and case tricks browsers still honour.
 * 2. A URL inside a code span stays code. Turning `curl https://…` into a link would stop the
 *    reader copying what the author actually typed.
 */

export type LinkPart =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

/** Control characters and whitespace that a browser strips before reading a scheme. */
const IGNORED = /[\u0000-\u0020]+/g;

/** Whether this string may be put in an href. */
export function isSafeUrl(value: string): boolean {
  const cleaned = value.replace(IGNORED, "").toLowerCase();
  return cleaned.startsWith("http://") || cleaned.startsWith("https://");
}

/**
 * Matches an `http(s)` URL, stopping at whitespace and at characters that cannot appear in a
 * URL without encoding. The trailing trim handles the "look at https://example.com." case,
 * where the full stop belongs to the sentence.
 */
const SCHEME_URL = /https?:\/\/[^\s<>"'`]+/gi;

/**
 * Matches a bare domain like `example.com` so people do not have to type the scheme. The
 * lookbehind rejects a domain that is part of a word (an email address, mostly) and the
 * lookahead requires a plausible top-level domain, which keeps "т.д." out.
 */
const BARE_DOMAIN =
  /(?<![\w@.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|ru|org|net|io|dev|app|me|co|info|pro|tech|site|store|online|xyz|ai|edu|gov|museum|tv|fm|gg|to|su|by|kz|ua|de|fr|uk|jp|cn))(?:\/[^\s<>"'`]*)?(?![\w-])/gi;

/** Punctuation that ends a sentence rather than a URL. */
const TRAILING = /[.,;:!?»"')]+$/;

function trimTrailing(url: string): string {
  // A closing bracket is part of the URL when it is balanced, which is why only the
  // asymmetric punctuation is stripped here.
  let trimmed = url.replace(TRAILING, "");
  while (trimmed.endsWith(")") && (trimmed.match(/\)/g)?.length ?? 0) > (trimmed.match(/\(/g)?.length ?? 0)) {
    trimmed = trimmed.slice(0, -1).replace(TRAILING, "");
  }
  return trimmed;
}

type Match = { start: number; end: number; text: string; href: string };

/** All the link-shaped matches in a string, in order, without overlaps. */
function findMatches(text: string): Match[] {
  const matches: Match[] = [];
  const take = (regex: RegExp, withScheme: boolean) => {
    regex.lastIndex = 0;
    for (const found of text.matchAll(regex)) {
      const raw = found[0];
      const start = found.index ?? 0;
      const trimmed = trimTrailing(raw);
      if (trimmed === "") continue;
      const href = withScheme ? trimmed : `https://${trimmed}`;
      if (!isSafeUrl(href)) continue;
      matches.push({ start, end: start + trimmed.length, text: trimmed, href });
    }
  };
  take(SCHEME_URL, true);
  take(BARE_DOMAIN, false);

  // A bare domain inside an explicit URL is the same link; keep the longer one.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Match[] = [];
  for (const match of matches) {
    const previous = kept[kept.length - 1];
    if (previous && match.start < previous.end) continue;
    kept.push(match);
  }
  return kept;
}

/** Splits a message into text and links. */
export function linkify(text: string): LinkPart[] {
  const matches = findMatches(text);
  if (matches.length === 0) return text === "" ? [] : [{ kind: "text", text }];
  const parts: LinkPart[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) parts.push({ kind: "text", text: text.slice(cursor, match.start) });
    parts.push({ kind: "link", text: match.text, href: match.href });
    cursor = match.end;
  }
  if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) });
  return parts;
}

/** The first usable address in a message, for its preview card. */
export function firstLink(text: string): string | null {
  const match = findMatches(text)[0];
  return match ? match.href : null;
}

export type LinkSegment = MarkupSegment | { kind: "link"; text: string; href: string };

/**
 * Applies links to already-parsed markup.
 *
 * Code and pre segments pass through untouched: a URL there is part of the code. Everything
 * else is split, because a link can sit inside bold text and should stay bold.
 */
export function linkifySegments(segments: MarkupSegment[]): LinkSegment[] {
  const result: LinkSegment[] = [];
  for (const segment of segments) {
    if (segment.kind === "code" || segment.kind === "pre") {
      result.push(segment);
      continue;
    }
    const parts = linkify(segment.text);
    if (parts.length === 1 && parts[0].kind === "text") {
      result.push(segment);
      continue;
    }
    for (const part of parts) {
      if (part.kind === "text") result.push({ ...segment, text: part.text });
      else result.push({ kind: "link", text: part.text, href: part.href });
    }
  }
  return result;
}

/** A link's preview card, as the edge function returns it. */
export type LinkCard = {
  url: string;
  title: string;
  description: string;
  image: string;
  site: string;
};

/** Whether a card has enough to be worth a row in the conversation. */
export function cardIsUsable(card: LinkCard | null): card is LinkCard {
  return Boolean(card && (card.title.trim() !== "" || card.description.trim() !== ""));
}

/**
 * The image URL of a card, or null.
 *
 * An image is loaded from a third-party host chosen by whoever wrote the message, so it is
 * held to the same rule as a link: http or https only. A card is useful without its picture;
 * it is not worth an exception.
 */
export function cardImage(card: LinkCard): string | null {
  if (!card.image) return null;
  return isSafeUrl(card.image) ? card.image : null;
}

/** The site name to show on a card, falling back to the domain. */
export function cardSite(card: LinkCard): string {
  if (card.site.trim() !== "") return card.site.trim();
  try {
    return new URL(card.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
