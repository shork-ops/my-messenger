import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const storage = new Map<string, string>();

vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  },
});

const { pushPromptAlreadySeen } = await import("./pushPrompt");

describe("pushPromptAlreadySeen", () => {
  beforeEach(() => storage.clear());
  afterEach(() => storage.clear());

  it("is false for a fresh browser", () => {
    expect(pushPromptAlreadySeen()).toBe(false);
  });

  it("is true once the prompt has been recorded", () => {
    storage.set("nexus:push-prompt", "asked");
    expect(pushPromptAlreadySeen()).toBe(true);
  });

  it("treats any other stored value as not asked", () => {
    storage.set("nexus:push-prompt", "something-else");
    expect(pushPromptAlreadySeen()).toBe(false);
  });
});
