import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEDIA_POLICY,
  MEDIA_POLICIES,
  MEDIA_POLICY_STORAGE_KEY,
  parseMediaPolicy,
  shouldAutoload,
} from "./mediaPolicy";

describe("MEDIA_POLICIES", () => {
  it("offers three choices", () => {
    expect(MEDIA_POLICIES.length).toBe(3);
  });

  it("has unique ids and a hint for each", () => {
    const ids = MEDIA_POLICIES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of MEDIA_POLICIES) expect(item.hint.length).toBeGreaterThan(0);
  });
});

describe("parseMediaPolicy", () => {
  it("keeps a known choice", () => {
    expect(parseMediaPolicy("manual")).toBe("manual");
    expect(parseMediaPolicy("always")).toBe("always");
  });

  it("falls back to the safe default", () => {
    expect(parseMediaPolicy(null)).toBe("wifi");
    expect(parseMediaPolicy("")).toBe("wifi");
    expect(parseMediaPolicy("CELLULAR")).toBe("wifi");
  });

  it("defaults to Wi-Fi, the only value that cannot spend traffic unnoticed", () => {
    expect(DEFAULT_MEDIA_POLICY).toBe("wifi");
  });
});

describe("shouldAutoload", () => {
  it("never loads in manual mode, whatever the network", () => {
    expect(shouldAutoload("manual", "wifi")).toBe(false);
    expect(shouldAutoload("manual", "cellular")).toBe(false);
    expect(shouldAutoload("manual", "unknown")).toBe(false);
  });

  it("always loads in always mode", () => {
    expect(shouldAutoload("always", "wifi")).toBe(true);
    expect(shouldAutoload("always", "cellular")).toBe(true);
    expect(shouldAutoload("always", "unknown")).toBe(true);
  });

  it("waits for a tap on cellular in Wi-Fi mode", () => {
    expect(shouldAutoload("wifi", "cellular")).toBe(false);
  });

  it("loads on Wi-Fi in Wi-Fi mode", () => {
    expect(shouldAutoload("wifi", "wifi")).toBe(true);
  });

  it("treats an unknown network as Wi-Fi, so a desktop is not left waiting", () => {
    expect(shouldAutoload("wifi", "unknown")).toBe(true);
  });
});

describe("MEDIA_POLICY_STORAGE_KEY", () => {
  it("is a nexus key, so clearing the cache resets it", () => {
    expect(MEDIA_POLICY_STORAGE_KEY).toBe("nexus-media-policy");
  });
});
