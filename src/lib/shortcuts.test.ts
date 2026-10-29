import { describe, expect, it } from "vitest";
import { SHORTCUTS, matchShortcut } from "./shortcuts";

/** A fake target with a tag name, standing in for the focused element. */
const tag = (name: string) => ({ tagName: name, isContentEditable: false }) as unknown as EventTarget;

describe("SHORTCUTS", () => {
  it("lists every shortcut with a label", () => {
    expect(SHORTCUTS.length).toBeGreaterThan(4);
    for (const shortcut of SHORTCUTS) expect(shortcut.label.length).toBeGreaterThan(0);
  });

  it("has no duplicate key-and-modifier combinations", () => {
    const seen = SHORTCUTS.map((s) => `${s.ctrlOrMeta ? "^" : ""}${s.shift ? "+" : ""}${s.key}`);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("matchShortcut", () => {
  it("matches a plain key", () => {
    expect(matchShortcut({ key: "Escape" })?.key).toBe("escape");
  });

  it("matches a control combination", () => {
    expect(matchShortcut({ key: "k", ctrlKey: true })?.key).toBe("k");
  });

  it("matches a command combination on a Mac", () => {
    expect(matchShortcut({ key: "k", metaKey: true })?.key).toBe("k");
  });

  it("does not match a bare letter that needs a modifier", () => {
    expect(matchShortcut({ key: "k" })).toBeNull();
  });

  it("does not match a modifier combination that needs none", () => {
    expect(matchShortcut({ key: "Escape", ctrlKey: true })).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(matchShortcut({ key: "K", ctrlKey: true })?.key).toBe("k");
  });

  it("distinguishes shifted from unshifted", () => {
    expect(matchShortcut({ key: "?", shiftKey: true })?.key).toBe("?");
    expect(matchShortcut({ key: "?", shiftKey: false })).toBeNull();
  });

  it("ignores alt combinations, which belong to the operating system", () => {
    expect(matchShortcut({ key: "Escape", altKey: true })?.key).toBe("escape");
  });

  // The typing rule is the whole reason this module exists.
  it("does not steal a keystroke from a text field", () => {
    expect(matchShortcut({ key: "k", ctrlKey: true, target: tag("INPUT") })).toBeNull();
    expect(matchShortcut({ key: "ArrowUp", target: tag("TEXTAREA") })).toBeNull();
    expect(matchShortcut({ key: "?", shiftKey: true, target: tag("INPUT") })).toBeNull();
  });

  it("lets Escape through while typing, because it is how you leave a field", () => {
    expect(matchShortcut({ key: "Escape", target: tag("TEXTAREA") })?.key).toBe("escape");
  });

  it("does not steal from a select or a contenteditable", () => {
    expect(matchShortcut({ key: "ArrowUp", target: tag("SELECT") })).toBeNull();
    const editable = { tagName: "DIV", isContentEditable: true } as unknown as EventTarget;
    expect(matchShortcut({ key: "ArrowUp", target: editable })).toBeNull();
  });

  it("works with no target, as when the event comes from the window", () => {
    expect(matchShortcut({ key: "Escape", target: null })?.key).toBe("escape");
  });

  it("returns null for a key that is not a shortcut", () => {
    expect(matchShortcut({ key: "q" })).toBeNull();
    expect(matchShortcut({ key: "F13" })).toBeNull();
  });
});
