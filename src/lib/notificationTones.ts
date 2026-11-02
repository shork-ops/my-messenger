/**
 * Message tones, synthesized rather than loaded.
 *
 * A bundled audio file is one more thing to fail to download on a slow connection, and a
 * message that arrives silently is worse than a plain sound. Each tone is a few notes, so five
 * of them cost less than one tiny audio file.
 */

export type ToneId = "chime" | "drop" | "bell" | "trill" | "soft";

export const DEFAULT_TONE: ToneId = "chime";

/** [start in seconds, frequency in Hz, length in seconds, waveform]. */
type Note = [number, number, number, OscillatorType];

const TONE_NOTES: Record<ToneId, Note[]> = {
  // The original two-tone chime: a fifth apart, recognizable without being shrill.
  chime: [
    [0, 880, 0.18, "sine"],
    [0.12, 1174, 0.18, "sine"],
  ],
  drop: [[0, 1568, 0.14, "sine"]],
  bell: [
    [0, 1318, 0.5, "triangle"],
    [0, 2637, 0.3, "sine"],
  ],
  trill: [
    [0, 1046, 0.09, "triangle"],
    [0.08, 1318, 0.09, "triangle"],
    [0.16, 1568, 0.14, "triangle"],
  ],
  soft: [
    [0, 523, 0.3, "sine"],
    [0.14, 659, 0.34, "sine"],
  ],
};

export function isToneId(value: unknown): value is ToneId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TONE_NOTES, value);
}

/** The notes of a tone; exported for tests. */
export function toneNotes(id: ToneId): Note[] {
  return TONE_NOTES[id] ?? TONE_NOTES[DEFAULT_TONE];
}

/** Plays a tone once. Silent when the browser has no audio or refuses to start it. */
export function playTone(id: ToneId): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    const now = context.currentTime;
    let end = 0;
    for (const [time, frequency, length, wave] of toneNotes(id)) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + time);
      gain.gain.exponentialRampToValueAtTime(0.16, now + time + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + time + length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + time);
      oscillator.stop(now + time + length + 0.02);
      end = Math.max(end, time + length);
    }
    // Release the audio context; browsers cap how many may exist.
    window.setTimeout(() => void context.close().catch(() => undefined), (end + 0.4) * 1000);
  } catch {
    // Autoplay policy refused: the notification itself still appears.
  }
}
