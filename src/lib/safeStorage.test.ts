import { beforeEach, describe, expect, it } from "vitest";
import { readItem, removeItem, storageAvailable, writeItem } from "./safeStorage";

// The suite runs in Node, so `window` is provided by the test rather than a browser.
function replaceStorage(store: Record<string, unknown>) {
  (globalThis as { window?: unknown }).window = { localStorage: store };
}

function breakStorage() {
  const thrower = () => {
    throw new Error("SecurityError");
  };
  replaceStorage({ getItem: thrower, setItem: thrower, removeItem: thrower, clear: thrower });
}

describe("safeStorage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    replaceStorage({
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
  });

  it("reads what it wrote", () => {
    writeItem("k", "v");
    expect(readItem("k")).toBe("v");
  });

  it("returns null for a missing key", () => {
    expect(readItem("missing")).toBeNull();
  });

  it("removes a key", () => {
    writeItem("k", "v");
    removeItem("k");
    expect(readItem("k")).toBeNull();
  });

  it("reports storage as available when it works", () => {
    expect(storageAvailable()).toBe(true);
  });

  // The whole point: a throwing storage must degrade, not crash.
  it("returns null instead of throwing when reading fails", () => {
    breakStorage();
    expect(() => readItem("k")).not.toThrow();
    expect(readItem("k")).toBeNull();
  });

  it("swallows a write that fails on a full quota", () => {
    breakStorage();
    expect(() => writeItem("k", "v")).not.toThrow();
  });

  it("swallows a failing removal", () => {
    breakStorage();
    expect(() => removeItem("k")).not.toThrow();
  });

  it("reports storage as unavailable when it throws", () => {
    breakStorage();
    expect(storageAvailable()).toBe(false);
  });

  it("leaves no probe key behind", () => {
    storageAvailable();
    expect(readItem("__nexus_probe__")).toBeNull();
  });

  it("works with no window at all, as when this module is imported on a server", () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(readItem("k")).toBeNull();
    expect(() => writeItem("k", "v")).not.toThrow();
    expect(storageAvailable()).toBe(false);
  });
});
