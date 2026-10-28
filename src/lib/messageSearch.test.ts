import { describe, expect, it } from "vitest";
import { splitHeadline } from "./messageSearch";

describe("splitHeadline", () => {
  it("splits highlighted fragments from plain text", () => {
    expect(splitHeadline("привет <mark>мир</mark> снова")).toEqual([
      { text: "привет ", marked: false },
      { text: "мир", marked: true },
      { text: " снова", marked: false },
    ]);
  });

  it("keeps several highlights in order", () => {
    expect(splitHeadline("<mark>а</mark> и <mark>б</mark>")).toEqual([
      { text: "а", marked: true },
      { text: " и ", marked: false },
      { text: "б", marked: true },
    ]);
  });

  it("returns a single plain part when nothing matched", () => {
    expect(splitHeadline("без подсветки")).toEqual([{ text: "без подсветки", marked: false }]);
  });

  it("does not treat angle brackets outside markers as markup", () => {
    const parts = splitHeadline("a < b and <mark>c</mark> > d");
    expect(parts.map((part) => part.marked)).toEqual([false, true, false]);
    expect(parts[0].text).toBe("a < b and ");
    expect(parts[1].text).toBe("c");
    expect(parts[2].text).toBe(" > d");
  });
});
