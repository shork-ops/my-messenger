import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { scopedKey, ownerFor } from "./accountScope";

const storage = new Map<string, string>();

vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
});

const { pushPromptAlreadySeen, rememberPushPrompt } = await import("./pushPrompt");

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";

describe("pushPromptAlreadySeen", () => {
  beforeEach(() => storage.clear());
  afterEach(() => storage.clear());

  it("is false for a fresh browser", () => {
    expect(pushPromptAlreadySeen(ALPHA)).toBe(false);
  });

  it("is true once the prompt has been recorded", () => {
    rememberPushPrompt(ALPHA);
    expect(pushPromptAlreadySeen(ALPHA)).toBe(true);
  });

  it("treats any other stored value as not asked", () => {
    storage.set(scopedKey(ownerFor(ALPHA), "nexus:push-prompt"), "something-else");
    expect(pushPromptAlreadySeen(ALPHA)).toBe(false);
  });

  it("does not record the prompt under a shared key", () => {
    // A bare key would silence the prompt for everyone on this browser.
    rememberPushPrompt(ALPHA);
    expect(storage.has("nexus:push-prompt")).toBe(false);
  });

  it("keeps each account's answer separate on a shared browser", () => {
    rememberPushPrompt(ALPHA);
    expect(pushPromptAlreadySeen(ALPHA)).toBe(true);
    expect(pushPromptAlreadySeen(BETA)).toBe(false);
    expect(pushPromptAlreadySeen(null)).toBe(false);
  });

  it("does not carry the guest's answer into an account", () => {
    rememberPushPrompt(null);
    expect(pushPromptAlreadySeen(null)).toBe(true);
    expect(pushPromptAlreadySeen(ALPHA)).toBe(false);
  });
});
