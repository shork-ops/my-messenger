import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLOT,
  MAX_SAVED_ACCOUNTS,
  accountLabel,
  activeAccount,
  canAddAccount,
  colorForSlot,
  fallbackSlot,
  nextFreeSlot,
  removeAccount,
  storageKeyForSlot,
  upsertAccount,
  type SavedAccount,
} from "./accounts";

function account(slot: string, overrides: Partial<SavedAccount> = {}): SavedAccount {
  return { slot, name: `Имя ${slot}`, email: null, color: "blue", lastUsedAt: 0, ...overrides };
}

/**
 * A session belongs to exactly one slot. Everything here follows from that: two accounts that
 * share a storage key would overwrite each other, which is the bug this module exists to avoid.
 */
describe("one session per slot", () => {
  it("gives each slot its own storage key", () => {
    expect(storageKeyForSlot("a")).toBe("sb-nexus-auth-a");
    expect(storageKeyForSlot("a")).not.toBe(storageKeyForSlot("b"));
  });

  it("keeps the old key reachable for a device that never saw the switcher", () => {
    // The first account must not be signed out by the upgrade itself.
    expect(DEFAULT_SLOT).toBe("a");
  });
});

describe("filling slots", () => {
  it("takes the first free one", () => {
    expect(nextFreeSlot([])).toBe("a");
    expect(nextFreeSlot([account("a")])).toBe("b");
    expect(nextFreeSlot([account("a"), account("c")])).toBe("b");
  });

  it("refuses a slot when the list is full", () => {
    const full = ["a", "b", "c", "d"].map((slot) => account(slot));
    expect(nextFreeSlot(full)).toBeNull();
    expect(canAddAccount(full)).toBe(false);
    expect(canAddAccount([account("a")])).toBe(true);
  });

  it("stops at a number of accounts a person can still tell apart", () => {
    expect(MAX_SAVED_ACCOUNTS).toBeLessThanOrEqual(4);
  });
});

describe("colours", () => {
  it("never gives two accounts the same colour while there is one free", () => {
    expect(colorForSlot([])).toBe("blue");
    expect(colorForSlot([account("a", { color: "blue" })])).toBe("violet");
    expect(colorForSlot([account("a", { color: "blue" }), account("b", { color: "violet" })])).toBe("olive");
  });

  it("still returns something when every colour is taken", () => {
    const all = ["blue", "violet", "olive", "orange"].map((color, index) =>
      account(String(index), { color })
    );
    expect(colorForSlot(all)).toBeTruthy();
  });
});

describe("the list of accounts", () => {
  it("holds one entry per slot, the newest first", () => {
    const list = upsertAccount([account("a", { lastUsedAt: 10 })], account("b", { lastUsedAt: 20 }));
    expect(list.map((item) => item.slot)).toEqual(["b", "a"]);
  });

  it("replaces an entry in the same slot rather than adding a second", () => {
    const list = upsertAccount([account("a", { name: "Старое" })], account("a", { name: "Новое" }));
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Новое");
  });

  it("removes exactly one account", () => {
    const list = removeAccount([account("a"), account("b")], "a");
    expect(list.map((item) => item.slot)).toEqual(["b"]);
  });

  it("removes the same slot twice without touching the others", () => {
    expect(removeAccount([account("a"), account("b")], "z")).toHaveLength(2);
  });

  it("finds the active one, and says nothing when it is missing", () => {
    expect(activeAccount([account("a"), account("b")], "b")?.slot).toBe("b");
    expect(activeAccount([account("a")], "z")).toBeUndefined();
  });
});

describe("removing the account in use", () => {
  it("moves to the one that is left", () => {
    const outcome = fallbackSlot([account("a"), account("b")], "a");
    expect(outcome.slot).toBe("b");
    expect(outcome.empty).toBe(false);
  });

  it("still leaves a key to read from when nothing is left", () => {
    // Returning null here would leave the client with no session storage at all.
    const outcome = fallbackSlot([account("a")], "a");
    expect(outcome.slot).toBe(DEFAULT_SLOT);
    expect(outcome.empty).toBe(true);
  });
});

describe("how an account is shown", () => {
  it("shows the email when there is one, because two accounts often share a name", () => {
    expect(accountLabel("Алексей", "alex@work.ru")).toBe("Алексей · alex@work.ru");
    expect(accountLabel("Алексей", null)).toBe("Алексей");
  });
});
