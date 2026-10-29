import { describe, expect, it } from "vitest";
import {
  PASSCODE_STORAGE_KEY,
  describeDevice,
  isValidPasscode,
  lastSeenLabel,
  passcodeMatches,
  shouldLock,
  upsertSession,
  type SessionRecord,
} from "./sessions";

const HOUR = 60 * 60 * 1000;

describe("describeDevice", () => {
  it("names an Android phone and its browser", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
    expect(describeDevice(ua)).toEqual({ label: "Chrome", platform: "Android" });
  });

  it("names an iPhone", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(describeDevice(ua).platform).toBe("iOS");
    expect(describeDevice(ua).label).toBe("Safari");
  });

  it("names desktop Windows and Edge", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120";
    expect(describeDevice(ua)).toEqual({ label: "Edge", platform: "Windows" });
  });

  it("names Yandex Browser, which also claims to be Chrome", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 YaBrowser/24.1 Safari/537.36";
    expect(describeDevice(ua).label).toBe("Яндекс Браузер");
  });

  it("names Firefox", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
    expect(describeDevice(ua).label).toBe("Firefox");
  });

  it("admits when it does not know", () => {
    expect(describeDevice("")).toEqual({ label: "Браузер", platform: "Неизвестно" });
  });
});

describe("upsertSession", () => {
  const now = new Date("2026-03-01T12:00:00Z").getTime();
  const record = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
    deviceId: "a",
    label: "Chrome",
    platform: "Windows",
    lastSeen: now,
    ...overrides,
  });

  it("adds a new device at the front", () => {
    const result = upsertSession([record({ deviceId: "b" })], record(), now);
    expect(result.map((item) => item.deviceId)).toEqual(["a", "b"]);
  });

  it("updates a device already present instead of duplicating it", () => {
    const result = upsertSession([record({ lastSeen: now - 5 * HOUR })], record(), now);
    expect(result).toHaveLength(1);
    expect(result[0].lastSeen).toBe(now);
  });

  it("drops records older than a month", () => {
    const stale = record({ deviceId: "old", lastSeen: now - 40 * 24 * HOUR });
    expect(upsertSession([stale], record(), now).map((item) => item.deviceId)).toEqual(["a"]);
  });
});

describe("lastSeenLabel", () => {
  const now = new Date("2026-03-01T12:00:00Z").getTime();

  it("says now for the current minute", () => {
    expect(lastSeenLabel(now - 10_000, now)).toBe("Сейчас");
  });

  it("counts minutes, hours and days", () => {
    expect(lastSeenLabel(now - 12 * 60_000, now)).toBe("12 мин назад");
    expect(lastSeenLabel(now - 5 * HOUR, now)).toBe("5 ч назад");
    expect(lastSeenLabel(now - 3 * 24 * HOUR, now)).toBe("3 дн назад");
  });
});

describe("isValidPasscode", () => {
  it("accepts exactly four digits", () => {
    expect(isValidPasscode("1234")).toBe(true);
    expect(isValidPasscode("0000")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidPasscode("123")).toBe(false);
    expect(isValidPasscode("12345")).toBe(false);
    expect(isValidPasscode("12a4")).toBe(false);
    expect(isValidPasscode("")).toBe(false);
  });
});

describe("passcodeMatches", () => {
  it("accepts the stored code", () => {
    expect(passcodeMatches("1234", "1234")).toBe(true);
  });

  it("rejects a different code", () => {
    expect(passcodeMatches("1234", "1235")).toBe(false);
  });

  it("rejects everything when no code is set", () => {
    expect(passcodeMatches(null, "1234")).toBe(false);
    expect(passcodeMatches("", "1234")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(passcodeMatches("1234", "123")).toBe(false);
  });
});

describe("shouldLock", () => {
  it("locks only when a code exists and the session is not unlocked", () => {
    expect(shouldLock(false, false)).toBe(false);
    expect(shouldLock(true, false)).toBe(true);
    expect(shouldLock(true, true)).toBe(false);
  });
});

describe("PASSCODE_STORAGE_KEY", () => {
  it("is a nexus key, so clear-cache owns it", () => {
    expect(PASSCODE_STORAGE_KEY).toBe("nexus-passcode");
  });
});
