import { describe, expect, it } from "vitest";
import { DEFAULT_PRIVACY, describeBlockError, lastSeenIsHidden, stripHiddenReceipts } from "./privacy";

describe("stripHiddenReceipts", () => {
  it("removes readers who turned receipts off", () => {
    const receipts = { "user-a": 1000, "user-b": 2000 };
    expect(stripHiddenReceipts(receipts, ["user-a"])).toEqual({ "user-b": 2000 });
  });

  it("keeps everything when nobody hid receipts", () => {
    const receipts = { "user-a": 1000 };
    expect(stripHiddenReceipts(receipts, [])).toBe(receipts);
  });

  it("drops every entry when all readers are hidden", () => {
    expect(stripHiddenReceipts({ "user-a": 1, "user-b": 2 }, ["user-a", "user-b"])).toEqual({});
  });
});

describe("lastSeenIsHidden", () => {
  it("treats a null timestamp as hidden", () => {
    expect(lastSeenIsHidden(null)).toBe(true);
    expect(lastSeenIsHidden(1_700_000_000_000)).toBe(false);
    // Zero is a real timestamp, not a missing value.
    expect(lastSeenIsHidden(0)).toBe(false);
  });
});

describe("describeBlockError", () => {
  it("explains the two cases the server can raise", () => {
    expect(describeBlockError("You cannot block yourself")).toBe("Нельзя заблокировать себя");
    expect(describeBlockError("This user is not available")).toBe("Этот пользователь недоступен");
  });

  it("passes unknown errors through", () => {
    expect(describeBlockError("network unreachable")).toBe("network unreachable");
  });
});

describe("DEFAULT_PRIVACY", () => {
  it("hides nothing until the user asks", () => {
    expect(DEFAULT_PRIVACY).toEqual({ hideLastSeen: false, disableReadReceipts: false });
  });
});
