/**
 * Message markup.
 *
 * A small formatter for the way people actually type: `**bold**`, `*italic*`, `~~strike~~`,
 * `` `code` ``, ```` ```lang ```` blocks and `||spoilers||`.
 *
 * The design rule that decides every hard case: **markup must never make a message
 * unreadable.** Someone writing "2 * 3 * 4" means arithmetic, and someone pasting a shell
 * command with one backtick means a backtick. An unmatched marker therefore stays exactly
 * as typed instead of being swallowed. That is why this is a hand-written scanner and not a
 * Markdown library: a Markdown library is optimised for documents, where an unterminated
 * `**` is a formatting mistake worth rendering as one.
 *
 * The parser returns a flat list of segments, not a tree. Nesting is expressed with the
 * `bold`/`italic`/`strike` flags on a segment, because the renderer only needs to decide
 * which CSS class to put on a span — a tree would be more structure than the twenty lines
 * of JSX that consume it.
 */

export type MarkupSegment = {
  kind: "text" | "bold" | "italic" | "strike" | "code" | "pre" | "spoiler";
  text: string;
  /** Present on a fenced code block. */
  language?: string;
  /** A segment that is bold *and* italic carries both flags. */
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
};

/** Ordered longest-first: `**` must be tried before `*`, or bold reads as two italics. */
const MARKERS = [
  { token: "```", kind: "pre" as const },
  { token: "**", kind: "bold" as const },
  { token: "~~", kind: "strike" as const },
  { token: "||", kind: "spoiler" as const },
  { token: "_", kind: "italic" as const },
  { token: "*", kind: "italic" as const },
  { token: "`", kind: "code" as const },
];

/** Cheap pre-check: a message with none of these needs no parsing at all. */
const MARKER_PATTERN = /[*_~`|]/;

export function markupSupported(text: string): boolean {
  return MARKER_PATTERN.test(text);
}

/** True when a marker at `index` has no partner later in the string. */
function findClosing(text: string, token: string, from: number): number {
  const index = text.indexOf(token, from);
  if (index === -1) return -1;
  // A closing marker must have content before it: `**` immediately after the opener is
  // an empty pair, which means the author typed stars, not formatting.
  return index === from ? -1 : index;
}

/** Reads a fenced block, which may carry a language after the opening fence. */
function readFence(text: string, start: number): { language: string; body: string; end: number } | null {
  const afterOpen = start + 3;
  const close = text.indexOf("```", afterOpen);
  if (close === -1) return null;
  const inner = text.slice(afterOpen, close);
  const newline = inner.indexOf("\n");
  // ```ts on its own first line names the language; without a newline there is no block,
  // just a word the author wrapped in backticks.
  if (newline === -1) {
    const language = inner.trim();
    return { language: language === "" ? "text" : language, body: "", end: close + 3 };
  }
  const language = inner.slice(0, newline).trim() || "text";
  const body = inner.slice(newline + 1);
  return { language, body: body.endsWith("\n") ? body.slice(0, -1) : body, end: close + 3 };
}

/**
 * Formats a message body into segments.
 *
 * Nested markers are supported one level deep (bold containing italic is the only nesting
 * that shows up in practice), and markers inside code are left alone — a code span showing
 * literal asterisks is the whole point of a code span.
 */
export function formatMarkup(text: string): MarkupSegment[] {
  if (!markupSupported(text)) return text === "" ? [] : [{ kind: "text", text }];

  const segments: MarkupSegment[] = [];
  let buffer = "";
  let cursor = 0;

  const flush = () => {
    if (buffer !== "") {
      segments.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (cursor < text.length) {
    const fence = text.startsWith("```", cursor) ? readFence(text, cursor) : null;
    if (fence) {
      flush();
      segments.push({ kind: "pre", text: fence.body, language: fence.language });
      cursor = fence.end;
      continue;
    }

    let matched = false;
    for (const marker of MARKERS) {
      if (marker.kind === "pre") continue;
      if (!text.startsWith(marker.token, cursor)) continue;
      // A marker that opens after whitespace and closes before whitespace is arithmetic or
      // a literal star, not emphasis: "2 * 3 * 4" and "a * b" must survive unchanged.
      if (marker.kind === "italic" && cursor > 0 && /\s/.test(text[cursor - 1])) {
        const close = findClosing(text, marker.token, cursor + marker.token.length);
        if (close !== -1 && /\s/.test(text[close - 1])) continue;
      }

      // Code is read first and verbatim: whatever is inside is literal.
      if (marker.kind === "code") {
        const close = findClosing(text, "`", cursor + 1);
        if (close === -1) continue;
        flush();
        segments.push({ kind: "code", text: text.slice(cursor + 1, close) });
        cursor = close + 1;
        matched = true;
        break;
      }

      const close = findClosing(text, marker.token, cursor + marker.token.length);
      if (close === -1) continue;

      flush();
      const inner = text.slice(cursor + marker.token.length, close);
      // Inner markup resolves to flags on the same segment, so bold-italic is one span.
      const nested = formatMarkup(inner);
      for (const piece of nested) {
        segments.push(combine(piece, marker.kind));
      }

      cursor = close + marker.token.length;
      matched = true;
      break;
    }

    if (matched) continue;
    buffer += text[cursor];
    cursor += 1;
  }

  flush();
  // Markup that consumed the whole message without leaving a single character is not
  // markup: someone typing `****` meant four stars.
  if (segments.length === 0 || segments.every((segment) => segment.text === "")) {
    return [{ kind: "text", text }];
  }
  return segments;
}

/** Applies a wrapper marker to a nested segment. */
function combine(piece: MarkupSegment, kind: "bold" | "italic" | "strike" | "spoiler"): MarkupSegment {
  // Code and pre keep their own styling: a code span inside bold is still a code span.
  if (piece.kind === "code" || piece.kind === "pre") return piece;
  // Plain text takes the wrapper's kind outright. Anything already formatted keeps its
  // own kind and gains a flag, so `**a _b_ c**` gives bold text and bold-italic text
  // without ever setting a flag that its kind already implies.
  if (piece.kind === "text") return { kind, text: piece.text };
  const wrapped: MarkupSegment = { ...piece };
  if (kind === "bold") wrapped.bold = true;
  if (kind === "italic") wrapped.italic = true;
  if (kind === "strike") wrapped.strike = true;
  if (kind === "spoiler") wrapped.kind = "spoiler";
  return wrapped;
}

/** Strips markup to plain text — for a chat-list preview or a notification body. */
export function plainText(text: string): string {
  return formatMarkup(text)
    .map((segment) => segment.text)
    .join("");
}
