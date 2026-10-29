import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFS,
  VIBRATION_PATTERN,
  formatMinute,
  inQuietHours,
  minutesOfDay,
  parseMinute,
  parsePrefs,
  serializePrefs,
  shouldPlaySound,
  shouldVibrate,
} from "./notificationPrefs";

const at = (hours: number, minutes = 0) => {
  const d = new Date(2026, 0, 15, hours, minutes, 0, 0);
  return d;
};

const night = { enabled: true, fromMinute: 22 * 60, toMinute: 8 * 60 };
const daytime = { enabled: true, fromMinute: 9 * 60, toMinute: 18 * 60 };

describe("minutesOfDay", () => {
  it("counts from local midnight", () => {
    expect(minutesOfDay(at(0, 0))).toBe(0);
    expect(minutesOfDay(at(13, 45))).toBe(13 * 60 + 45);
    expect(minutesOfDay(at(23, 59))).toBe(1439);
  });
});

describe("inQuietHours", () => {
  it("is false when the window is off", () => {
    expect(inQuietHours({ ...night, enabled: false }, at(23))).toBe(false);
  });

  it("covers the evening side of a window that wraps midnight", () => {
    expect(inQuietHours(night, at(22))).toBe(true);
    expect(inQuietHours(night, at(23, 30))).toBe(true);
  });

  it("covers the morning side as well", () => {
    expect(inQuietHours(night, at(0, 30))).toBe(true);
    expect(inQuietHours(night, at(7, 59))).toBe(true);
  });

  it("excludes the end of the window", () => {
    expect(inQuietHours(night, at(8))).toBe(false);
  });

  it("excludes the hours in between", () => {
    expect(inQuietHours(night, at(12))).toBe(false);
    expect(inQuietHours(night, at(21, 59))).toBe(false);
  });

  it("handles a window inside one day", () => {
    expect(inQuietHours(daytime, at(9))).toBe(true);
    expect(inQuietHours(daytime, at(17, 59))).toBe(true);
    expect(inQuietHours(daytime, at(18))).toBe(false);
    expect(inQuietHours(daytime, at(8, 59))).toBe(false);
  });

  it("treats an empty window as never quiet", () => {
    expect(inQuietHours({ enabled: true, fromMinute: 600, toMinute: 600 }, at(10))).toBe(false);
  });
});

describe("shouldPlaySound", () => {
  const base = { ...DEFAULT_NOTIFICATION_PREFS, quiet: night };

  it("plays when enabled and outside the window", () => {
    expect(shouldPlaySound(base, at(12))).toBe(true);
  });

  it("stays silent when the sound is off", () => {
    expect(shouldPlaySound({ ...base, sound: false }, at(12))).toBe(false);
  });

  it("stays silent inside the quiet window", () => {
    expect(shouldPlaySound(base, at(2))).toBe(false);
  });
});

describe("shouldVibrate", () => {
  const base = { ...DEFAULT_NOTIFICATION_PREFS, quiet: night };

  it("buzzes outside the window", () => {
    expect(shouldVibrate(base, at(12))).toBe(true);
  });

  it("does not buzz inside the window", () => {
    expect(shouldVibrate(base, at(23))).toBe(false);
  });

  it("respects the switch", () => {
    expect(shouldVibrate({ ...base, vibration: false }, at(12))).toBe(false);
  });
});

describe("formatMinute", () => {
  it("pads to two digits", () => {
    expect(formatMinute(0)).toBe("00:00");
    expect(formatMinute(8 * 60)).toBe("08:00");
    expect(formatMinute(22 * 60)).toBe("22:00");
    expect(formatMinute(23 * 60 + 5)).toBe("23:05");
  });

  it("wraps out-of-range values instead of printing nonsense", () => {
    expect(formatMinute(1440)).toBe("00:00");
    expect(formatMinute(-60)).toBe("23:00");
  });
});

describe("parseMinute", () => {
  it("reads a valid time", () => {
    expect(parseMinute("22:00")).toBe(1320);
    expect(parseMinute("8:05")).toBe(485);
  });

  it("tolerates surrounding spaces", () => {
    expect(parseMinute("  07:30 ")).toBe(450);
  });

  it("rejects nonsense", () => {
    expect(parseMinute("")).toBeNull();
    expect(parseMinute("24:00")).toBeNull();
    expect(parseMinute("12:60")).toBeNull();
    expect(parseMinute("полдень")).toBeNull();
  });

  it("round-trips with formatMinute", () => {
    for (const minute of [0, 480, 1320, 1439]) {
      expect(parseMinute(formatMinute(minute))).toBe(minute);
    }
  });
});

describe("VIBRATION_PATTERN", () => {
  it("is a pattern of alternating on and off pulses", () => {
    expect(VIBRATION_PATTERN.length).toBeGreaterThanOrEqual(3);
    expect(VIBRATION_PATTERN.every((value) => value > 0)).toBe(true);
  });
});

describe("parsePrefs", () => {
  it("returns defaults for nothing stored", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parsePrefs("")).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("returns defaults for unreadable data rather than total silence", () => {
    expect(parsePrefs("{not json")).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("round-trips a stored value", () => {
    const prefs = { sound: false, vibration: true, quiet: { enabled: true, fromMinute: 60, toMinute: 120 } };
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
  });

  it("fills in fields that a older version did not store", () => {
    const parsed = parsePrefs(JSON.stringify({ sound: false }));
    expect(parsed.sound).toBe(false);
    expect(parsed.vibration).toBe(DEFAULT_NOTIFICATION_PREFS.vibration);
    expect(parsed.quiet).toEqual(DEFAULT_NOTIFICATION_PREFS.quiet);
  });

  it("ignores a wrongly typed field", () => {
    const parsed = parsePrefs(JSON.stringify({ sound: "yes", vibration: 1 }));
    expect(parsed.sound).toBe(DEFAULT_NOTIFICATION_PREFS.sound);
    expect(parsed.vibration).toBe(DEFAULT_NOTIFICATION_PREFS.vibration);
  });
});
