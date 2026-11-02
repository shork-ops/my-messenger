import { describe, expect, it } from "vitest";
import { DEFAULT_TONE, isToneId, toneNotes } from "./notificationTones";
import { TONE_CHOICES } from "./notificationToneList";

describe("notification tones", () => {
  it("offers every tone in settings exactly once, the default first", () => {
    const ids = TONE_CHOICES.map((tone) => tone.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(DEFAULT_TONE);
    for (const id of ids) expect(isToneId(id)).toBe(true);
  });

  it("keeps every tone short and audible", () => {
    for (const { id } of TONE_CHOICES) {
      const notes = toneNotes(id);
      expect(notes.length).toBeGreaterThan(0);
      for (const [start, frequency, length] of notes) {
        // Under a second in total: a tone announces a message, it is not a ringtone.
        expect(start + length).toBeLessThan(1);
        expect(frequency).toBeGreaterThan(200);
        expect(frequency).toBeLessThan(4000);
      }
    }
  });

  it("does not take inherited names for tones", () => {
    expect(isToneId("constructor")).toBe(false);
    expect(isToneId(undefined)).toBe(false);
  });
});
