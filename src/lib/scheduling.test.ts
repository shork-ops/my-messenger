import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE_MINUTES, formatSendAt, isScheduled, nextPresets, parseSendAt, scheduleChoices } from "./scheduling";

/**
 * Sending later.
 *
 * The important decision is where the timer lives. A message waiting only in a browser tab
 * never arrives if the tab is closed, and a messenger that quietly loses a message is worse
 * than one that cannot schedule at all. So the timestamp is on the message and the row is
 * hidden from other people until that moment passes - the delay is enforced by the
 * database, not by whoever happens to keep a tab open.
 */

describe("scheduleChoices", () => {
  it("offers the times people actually want, not a date picker first", () => {
    const choices = scheduleChoices(new Date("2026-10-30T10:00:00"));
    expect(choices.length).toBeGreaterThanOrEqual(4);
    // Tomorrow morning is the classic case: writing at night to be read with coffee.
    expect(choices.some((choice) => choice.label.toLowerCase().includes("утро"))).toBe(true);
  });

  it("never offers a moment in the past", () => {
    const now = new Date("2026-10-30T23:50:00");
    for (const choice of scheduleChoices(now)) {
      expect(choice.at.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("puts the choices in order", () => {
    const choices = scheduleChoices(new Date("2026-10-30T10:00:00"));
    const times = choices.map((choice) => choice.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("has a default offset of an hour", () => {
    expect(DEFAULT_SCHEDULE_MINUTES).toBe(60);
  });
});

describe("parseSendAt", () => {
  it("reads a valid ISO string", () => {
    const at = parseSendAt("2026-10-30T18:00:00.000Z");
    expect(at?.toISOString()).toBe("2026-10-30T18:00:00.000Z");
  });

  it("returns null for anything unreadable", () => {
    expect(parseSendAt(null)).toBeNull();
    expect(parseSendAt("")).toBeNull();
    expect(parseSendAt("завтра")).toBeNull();
  });
});

describe("isScheduled", () => {
  it("treats a future moment as still pending", () => {
    expect(isScheduled("2026-10-30T18:00:00.000Z", new Date("2026-10-30T10:00:00.000Z"))).toBe(true);
  });

  it("treats a past moment as already delivered", () => {
    expect(isScheduled("2026-10-30T09:00:00.000Z", new Date("2026-10-30T10:00:00.000Z"))).toBe(false);
  });

  it("treats no timestamp as immediate", () => {
    expect(isScheduled(null, new Date())).toBe(false);
  });
});

describe("formatSendAt", () => {
  it("says today and tomorrow in words", () => {
    const now = new Date("2026-10-30T10:00:00");
    expect(formatSendAt(new Date("2026-10-30T18:30:00"), now)).toMatch(/сегодня/);
    expect(formatSendAt(new Date("2026-10-31T09:00:00"), now)).toMatch(/завтра/);
  });

  it("uses a date for anything further out", () => {
    const now = new Date("2026-10-30T10:00:00");
    const text = formatSendAt(new Date("2026-11-05T09:00:00"), now);
    expect(text).not.toMatch(/сегодня|завтра/);
    expect(text).toMatch(/\d/);
  });
});

describe("nextPresets", () => {
  it("labels its buttons for the aria and the tooltip", () => {
    for (const preset of nextPresets(new Date("2026-10-30T10:00:00"))) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.minutes).toBeGreaterThan(0);
    }
  });
});
