import { describe, expect, it, vi } from "vitest";
import {
  VOICE_SPEEDS,
  WAVEFORM_BARS,
  buildWaveform,
  decodeWaveform,
  encodeWaveform,
  formatDuration,
  formatVoiceSpeed,
  neutralWaveform,
  nextVoiceSpeed,
  readVoiceSpeed,
  saveVoiceSpeed,
} from "./voice";

describe("buildWaveform", () => {
  it("produces the requested number of bars", () => {
    expect(buildWaveform([0.1, 0.2, 0.3, 0.4], 4)).toHaveLength(4);
    expect(buildWaveform([1, 2, 3], WAVEFORM_BARS)).toHaveLength(WAVEFORM_BARS);
  });

  it("takes the peak of each bucket", () => {
    expect(buildWaveform([0.1, -0.9, 0.2, 0.3], 2)).toEqual([0.9, 0.3]);
  });

  it("clamps values above 1", () => {
    expect(buildWaveform([2, -3], 2)).toEqual([1, 1]);
  });

  it("is flat for silence and empty input", () => {
    expect(buildWaveform([], 3)).toEqual([0, 0, 0]);
    expect(buildWaveform([0, 0, 0, 0], 2)).toEqual([0, 0]);
  });

  it("returns nothing for zero bars", () => {
    expect(buildWaveform([0.5], 0)).toEqual([]);
  });
});

describe("encode / decode", () => {
  it("round-trips peaks through the quantised range", () => {
    const peaks = [0, 0.25, 0.5, 1];
    const decoded = decodeWaveform(encodeWaveform(peaks));
    expect(decoded).toHaveLength(4);
    decoded.forEach((value, index) => expect(value).toBeCloseTo(peaks[index], 1));
  });

  it("falls back to the neutral shape when nothing was stored", () => {
    expect(decodeWaveform(undefined, 5)).toEqual(neutralWaveform(5));
    expect(decodeWaveform([], 5)).toEqual(neutralWaveform(5));
  });
});

describe("neutralWaveform", () => {
  it("varies instead of drawing a flat line", () => {
    const shape = neutralWaveform(9);
    expect(new Set(shape.map((value) => value.toFixed(3))).size).toBeGreaterThan(1);
    shape.forEach((value) => expect(value).toBeGreaterThan(0));
  });
});

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("handles bad input", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});

describe("voice speed", () => {
  it("cycles 1× → 1,5× → 2× → 1×", () => {
    expect(nextVoiceSpeed(1)).toBe(1.5);
    expect(nextVoiceSpeed(1.5)).toBe(2);
    expect(nextVoiceSpeed(2)).toBe(1);
    expect(nextVoiceSpeed(3)).toBe(1);
  });

  it("labels speeds the Russian way", () => {
    expect(VOICE_SPEEDS.map(formatVoiceSpeed)).toEqual(["1×", "1,5×", "2×"]);
  });

  it("remembers the chosen speed and ignores junk", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    expect(readVoiceSpeed()).toBe(1);
    saveVoiceSpeed(2);
    expect(readVoiceSpeed()).toBe(2);
    localStorage.setItem("nexus-voice-speed", "7");
    expect(readVoiceSpeed()).toBe(1);
    vi.unstubAllGlobals();
  });
});
