import { describe, expect, it } from "vitest";
import {
  EDITED_LABEL,
  EDIT_WINDOW_MS,
  SOFT_DELETE_GRACE_MS,
  canDeleteForEveryone,
  canEdit,
  deletedPlaceholder,
  editedLabel,
  isRealEdit,
  mayPurgeText,
  undoSeconds,
} from "./messageEdit";

const NOW = 1_000_000_000_000;
const base = { senderId: "u1", createdAt: NOW - 60_000, text: "привет" };

describe("canEdit", () => {
  it("allows the author inside the window", () => {
    expect(canEdit(base, "u1", NOW)).toBe(true);
  });

  it("refuses anyone who is not the author", () => {
    expect(canEdit(base, "u2", NOW)).toBe(false);
  });

  it("refuses after the window has closed", () => {
    expect(canEdit({ ...base, createdAt: NOW - EDIT_WINDOW_MS - 1 }, "u1", NOW)).toBe(false);
  });

  it("still allows the message at the very edge of the window", () => {
    expect(canEdit({ ...base, createdAt: NOW - EDIT_WINDOW_MS }, "u1", NOW)).toBe(true);
  });

  it("refuses a deleted message", () => {
    expect(canEdit({ ...base, deleted: true }, "u1", NOW)).toBe(false);
  });

  it("refuses a message with no text, such as a bare attachment", () => {
    expect(canEdit({ ...base, text: "   " }, "u1", NOW)).toBe(false);
  });
});

describe("canDeleteForEveryone", () => {
  it("allows the author inside the window", () => {
    expect(canDeleteForEveryone(base, "u1", NOW)).toBe(true);
  });

  it("refuses others", () => {
    expect(canDeleteForEveryone(base, "u2", NOW)).toBe(false);
  });

  it("refuses after the window", () => {
    expect(canDeleteForEveryone({ ...base, createdAt: NOW - EDIT_WINDOW_MS - 1 }, "u1", NOW)).toBe(false);
  });

  it("refuses an already deleted message", () => {
    expect(canDeleteForEveryone({ ...base, deleted: true }, "u1", NOW)).toBe(false);
  });
});

describe("isRealEdit", () => {
  it("accepts a genuine change", () => {
    expect(isRealEdit("привет", "привет!")).toBe(true);
  });

  it("rejects a trailing space", () => {
    expect(isRealEdit("привет", "привет  ")).toBe(false);
  });

  it("rejects a change in whitespace only", () => {
    expect(isRealEdit("привет мир", "привет   мир")).toBe(false);
  });

  it("rejects emptying the message", () => {
    expect(isRealEdit("привет", "   ")).toBe(false);
  });

  it("treats leading whitespace as noise", () => {
    expect(isRealEdit("  привет", "привет")).toBe(false);
  });
});

describe("editedLabel", () => {
  it("marks an edited message", () => {
    expect(editedLabel(NOW)).toBe(EDITED_LABEL);
  });

  it("says nothing about an untouched one", () => {
    expect(editedLabel(null)).toBeNull();
    expect(editedLabel(undefined)).toBeNull();
    expect(editedLabel(0)).toBeNull();
  });
});

describe("deletedPlaceholder", () => {
  it("reads as a sentence, not a dash", () => {
    expect(deletedPlaceholder()).toMatch(/удалено/);
  });
});

describe("mayPurgeText", () => {
  it("holds the text during the grace period", () => {
    expect(mayPurgeText(NOW, NOW + 1000)).toBe(false);
  });

  it("releases it afterwards", () => {
    expect(mayPurgeText(NOW, NOW + SOFT_DELETE_GRACE_MS)).toBe(true);
  });

  it("never purges a message that was not deleted", () => {
    expect(mayPurgeText(null, NOW)).toBe(false);
  });
});

describe("undoSeconds", () => {
  it("counts down in whole seconds", () => {
    expect(undoSeconds(NOW + 60_000, NOW)).toBe(Math.ceil((SOFT_DELETE_GRACE_MS - 60_000) / 1000));
  });

  it("never goes below zero", () => {
    expect(undoSeconds(NOW + SOFT_DELETE_GRACE_MS * 2, NOW)).toBe(0);
  });
});
