import { describe, expect, it } from "vitest";
import {
  NOTE_BITRATE,
  VIDEO_NOTE_MAX_MS,
  VIDEO_NOTE_WARN_MS,
  formatNoteTime,
  isSendableNote,
  noteDurationLabel,
  noteFileName,
  noteProgress,
  noteRecorderOptions,
} from "./videoNote";

describe("constants", () => {
  it("caps a note at a minute", () => {
    expect(VIDEO_NOTE_MAX_MS).toBe(60_000);
  });

  it("warns before the cap, not at it", () => {
    expect(VIDEO_NOTE_WARN_MS).toBeLessThan(VIDEO_NOTE_MAX_MS);
  });
});

describe("noteProgress", () => {
  it("starts empty", () => {
    expect(noteProgress(0)).toBe(0);
  });

  it("grows with the recording", () => {
    expect(noteProgress(30_000)).toBeCloseTo(0.5);
  });

  it("stops at full", () => {
    expect(noteProgress(60_000)).toBe(1);
    expect(noteProgress(120_000)).toBe(1);
  });

  it("never goes negative or NaN", () => {
    expect(noteProgress(-500)).toBe(0);
    expect(noteProgress(Number.NaN)).toBe(0);
  });
});

describe("formatNoteTime", () => {
  it("formats seconds with a leading zero", () => {
    expect(formatNoteTime(7_000)).toBe("0:07");
    expect(formatNoteTime(59_000)).toBe("0:59");
  });

  it("formats a full minute", () => {
    expect(formatNoteTime(60_000)).toBe("1:00");
  });

  it("treats nonsense as zero rather than showing NaN", () => {
    expect(formatNoteTime(-1)).toBe("0:00");
    expect(formatNoteTime(Number.NaN)).toBe("0:00");
  });
});

describe("isSendableNote", () => {
  it("refuses a tap that recorded nothing", () => {
    expect(isSendableNote(0)).toBe(false);
    expect(isSendableNote(500)).toBe(false);
  });

  it("accepts a real clip", () => {
    expect(isSendableNote(800)).toBe(true);
    expect(isSendableNote(5_000)).toBe(true);
  });
});

describe("noteRecorderOptions", () => {
  it("asks for webm where it exists, because every Android and desktop has it", () => {
    const options = noteRecorderOptions(true);
    expect(options.mimeType).toContain("webm");
    expect(options.videoBitsPerSecond).toBe(NOTE_BITRATE);
  });

  it("falls back to mp4 for browsers that cannot encode webm", () => {
    const options = noteRecorderOptions(false);
    expect(options.mimeType).toContain("mp4");
  });
});

describe("noteDurationLabel", () => {
  it("matches the timer", () => {
    expect(noteDurationLabel(12_000)).toBe(formatNoteTime(12_000));
  });
});

describe("noteFileName", () => {
  it("records the length, so a saved note is identifiable", () => {
    expect(noteFileName(7_000, "webm")).toBe("video-note-7s.webm");
  });

  it("handles a clip shorter than a second", () => {
    expect(noteFileName(400, "webm")).toBe("video-note-0s.webm");
  });
});
