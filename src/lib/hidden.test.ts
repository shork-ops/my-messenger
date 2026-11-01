import { describe, expect, it } from "vitest";
import { HIDDEN_LABEL, SPOILER_MASK, hiddenBody, hideText, isHidden, maskSpoilers } from "./hidden";
import { formatMarkup } from "./markup";

describe("hidden messages", () => {
  it("wraps a draft into one cover and reads it back", () => {
    const sent = hideText("Сюрприз в пятницу");
    expect(sent).toBe("||Сюрприз в пятницу||");
    expect(isHidden(sent)).toBe(true);
    expect(hiddenBody(sent)).toBe("Сюрприз в пятницу");
  });

  it("keeps several lines under one cover", () => {
    const sent = hideText("первая\nвторая");
    expect(isHidden(sent)).toBe(true);
    expect(hiddenBody(sent)).toBe("первая\nвторая");
  });

  it("keeps pipes the sender typed from opening the cover early", () => {
    const sent = hideText("a || b ||| c");
    expect(isHidden(sent)).toBe(true);
    // Older builds read the body as one spoiler too, so nothing leaks there either.
    expect(formatMarkup(sent).every((segment) => segment.kind === "spoiler")).toBe(true);
    expect(hiddenBody(sent)).toBe("a || b ||| c");
  });

  it("does not take an ordinary message or two separate spoilers for a hidden one", () => {
    expect(isHidden("привет")).toBe(false);
    expect(isHidden("||||")).toBe(false);
    expect(isHidden("||   ||")).toBe(false);
    expect(isHidden("||один|| и ||два||")).toBe(false);
    expect(isHidden("конец ||спойлер||")).toBe(false);
  });
});

describe("previews give nothing away", () => {
  it("names a hidden message instead of quoting it", () => {
    expect(maskSpoilers(hideText("пароль от wi-fi"))).toBe(HIDDEN_LABEL);
  });

  it("turns each inline spoiler into a bar and leaves the rest", () => {
    expect(maskSpoilers("Убийца — ||дворецкий||, а ||мотив|| в письме")).toBe(
      `Убийца — ${SPOILER_MASK}, а ${SPOILER_MASK} в письме`
    );
  });

  it("leaves text without spoilers alone, including a lone pair of pipes", () => {
    expect(maskSpoilers("просто текст")).toBe("просто текст");
    expect(maskSpoilers("a || b")).toBe("a || b");
  });

  it("hides what follows a cover cut off on the way", () => {
    expect(maskSpoilers("||длинный текст, обрезанный на сто сорока", { truncated: true })).toBe(HIDDEN_LABEL);
    expect(maskSpoilers("Смотри: ||тут было что-то длинное", { truncated: true })).toBe(`Смотри: ${SPOILER_MASK}`);
  });
});
