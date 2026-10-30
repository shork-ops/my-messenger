import { describe, expect, it } from "vitest";
import { formatMarkup, markupSupported } from "./markup";

/**
 * Message markup.
 *
 * The rule that shapes every case below: markup must never make a message unreadable. A
 * stray asterisk from a multiplication sign, or an unmatched backtick in a shell command,
 * has to stay an asterisk or a backtick. Showing `**2 * 3**` as broken bold is worse than
 * showing it as written.
 */

describe("markupSupported", () => {
  it("recognises a message that contains markup", () => {
    expect(markupSupported("**жирный**")).toBe(true);
    expect(markupSupported("обычный текст")).toBe(false);
  });
});

describe("formatMarkup", () => {
  it("returns plain text as a single plain span", () => {
    expect(formatMarkup("привет")).toEqual([{ kind: "text", text: "привет" }]);
  });

  it("marks bold text", () => {
    expect(formatMarkup("это **важно** да")).toEqual([
      { kind: "text", text: "это " },
      { kind: "bold", text: "важно" },
      { kind: "text", text: " да" },
    ]);
  });

  it("marks italic with single asterisks", () => {
    expect(formatMarkup("*курсив*")).toEqual([{ kind: "italic", text: "курсив" }]);
  });

  it("marks underscore italic", () => {
    expect(formatMarkup("_курсив_")).toEqual([{ kind: "italic", text: "курсив" }]);
  });

  it("marks struck text", () => {
    expect(formatMarkup("~~было~~")).toEqual([{ kind: "strike", text: "было" }]);
  });

  it("marks inline code", () => {
    expect(formatMarkup("запусти `npm test`")).toEqual([
      { kind: "text", text: "запусти " },
      { kind: "code", text: "npm test" },
    ]);
  });

  it("marks a fenced code block with its language", () => {
    expect(formatMarkup("```ts\nconst a = 1;\n```")).toEqual([
      { kind: "pre", text: "const a = 1;", language: "ts" },
    ]);
  });

  it("marks a spoiler", () => {
    expect(formatMarkup("||Финал||")).toEqual([{ kind: "spoiler", text: "Финал" }]);
  });

  it("keeps an unmatched pair as literal text", () => {
    // 2 * 3 is arithmetic, not the start of italics.
    expect(formatMarkup("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
    expect(formatMarkup("одна звезда **")).toEqual([{ kind: "text", text: "одна звезда **" }]);
  });

  it("keeps an unmatched backtick literal", () => {
    expect(formatMarkup("незакрытый `код")).toEqual([{ kind: "text", text: "незакрытый `код" }]);
  });

  it("does not treat a lone pipe pair inside a word as a spoiler", () => {
    expect(formatMarkup("a||b||c")).toEqual([
      { kind: "text", text: "a" },
      { kind: "spoiler", text: "b" },
      { kind: "text", text: "c" },
    ]);
  });

  it("marks nested markup inside bold", () => {
    // The inner marker keeps its kind and gains a flag: the renderer reads one kind plus
    // flags, so "italic with bold on it" and "bold with italic on it" cannot both exist as
    // two different representations of the same thing.
    expect(formatMarkup("**важно _очень_**")).toEqual([
      { kind: "bold", text: "важно " },
      { kind: "italic", text: "очень", bold: true },
    ]);
  });

  it("does not format inside a code span", () => {
    expect(formatMarkup("`**не жирный**`")).toEqual([{ kind: "code", text: "**не жирный**" }]);
  });

  it("treats a message of only markup markers as literal text", () => {
    expect(formatMarkup("****")).toEqual([{ kind: "text", text: "****" }]);
    expect(formatMarkup("||||")).toEqual([{ kind: "text", text: "||||" }]);
  });

  it("handles multi-line messages and keeps the line breaks", () => {
    const result = formatMarkup("первая\n**вторая**");
    expect(result).toEqual([
      { kind: "text", text: "первая\n" },
      { kind: "bold", text: "вторая" },
    ]);
  });
});
