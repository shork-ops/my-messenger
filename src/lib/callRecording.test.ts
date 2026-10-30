import { describe, expect, it } from "vitest";
import {
  RECORDING_MIME_CANDIDATES,
  estimatedRecordingBytes,
  formatRecordingSize,
  pickRecordingMime,
  recordingBlocker,
  recordingExtension,
  recordingFileName,
  recordingLabel,
  recordingNotice,
} from "./callRecording";

describe("choosing what the browser can record", () => {
  it("prefers a codec it can also play back everywhere", () => {
    const picked = pickRecordingMime(() => true);
    expect(picked).toBe(RECORDING_MIME_CANDIDATES[0]);
  });

  it("falls back through the list rather than failing", () => {
    // Safari will not record vp9; asking for it and finding out at the first chunk means the
    // recording is already broken by the time the browser complains.
    const picked = pickRecordingMime((mime) => mime === "audio/webm");
    expect(picked).toBe("audio/webm");
  });

  it("returns nothing when the browser cannot record at all", () => {
    expect(pickRecordingMime(() => false)).toBeNull();
  });

  it("names the extension after what was chosen", () => {
    expect(recordingExtension("video/webm;codecs=vp9,opus")).toBe("webm");
    expect(recordingExtension("video/mp4")).toBe("mp4");
    expect(recordingExtension("application/octet-stream")).toBe("webm");
  });
});

describe("when recording may start", () => {
  const ok = { inCall: true, alreadyRecording: false, supported: true };

  it("allows it on a call, once, in a browser that can", () => {
    expect(recordingBlocker(ok)).toBeNull();
  });

  it("refuses outside a call", () => {
    expect(recordingBlocker({ ...ok, inCall: false })).toContain("только идущий звонок");
  });

  it("refuses a second recording", () => {
    expect(recordingBlocker({ ...ok, alreadyRecording: true })).toContain("уже идёт");
  });

  it("refuses a browser that cannot record, before the call rather than during it", () => {
    expect(recordingBlocker({ ...ok, supported: false })).toContain("не умеет");
  });
});

describe("what the person is told", () => {
  it("asks them to warn the others, in plain words", () => {
    const notice = recordingNotice();
    expect(notice).toContain("Предупредите участников");
    expect(notice).toContain("на этом устройстве");
  });

  it("counts the recording up in minutes and seconds", () => {
    expect(recordingLabel(0)).toBe("Запись · 00:00");
    expect(recordingLabel(83)).toBe("Запись · 01:23");
    expect(recordingLabel(-5)).toBe("Запись · 00:00");
  });
});

describe("the saved file", () => {
  it("is named after the conversation and the moment", () => {
    const at = new Date(2026, 9, 29, 14, 5).getTime();
    const name = recordingFileName("Аня", at);
    expect(name).toContain("Аня");
    expect(name).toContain("2026-10-29");
    expect(name).toContain("14-05");
    expect(name.endsWith(".webm")).toBe(true);
  });

  it("cannot break the file system with a slash in a chat name", () => {
    const at = new Date(2026, 9, 29, 14, 5).getTime();
    expect(recordingFileName("Семья/Работа", at)).not.toContain("/");
  });
});

describe("the size shown while recording", () => {
  it("warns that a video recording is large, and grows with time", () => {
    expect(RECORDING_MIME_CANDIDATES.length).toBeGreaterThan(1);
    expect(estimatedRecordingBytes(60, true)).toBeGreaterThan(estimatedRecordingBytes(60, false));
    expect(estimatedRecordingBytes(120, true)).toBeGreaterThan(estimatedRecordingBytes(60, true));
  });

  it("reads as a size a person can judge", () => {
    expect(formatRecordingSize(500 * 1024)).toContain("КБ");
    expect(formatRecordingSize(3 * 1024 * 1024)).toBe("≈ 3.0 МБ");
    expect(formatRecordingSize(40 * 1024 * 1024)).toBe("≈ 40 МБ");
  });
});