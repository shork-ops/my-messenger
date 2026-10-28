/**
 * Voice message helpers.
 *
 * The player draws a static waveform instead of a plain seek bar. Rendering the
 * real samples would mean decoding the audio file, which is slow and memory
 * hungry for a list of messages, so the bubble shows the peaks stored at send
 * time and falls back to a neutral shape for older messages.
 */

/** Bars drawn in the player; enough detail without crowding a phone screen. */
export const WAVEFORM_BARS = 32;

/** Peak values are quantised to 0..255 so they fit in a short JSON array. */
const PEAK_MAX = 255;

/**
 * Downsamples `samples` into `bars` peaks in the 0..1 range.
 *
 * Pure on purpose: the audio decoding lives in `analyseWaveform`, while the
 * arithmetic that decides bar heights is covered by unit tests.
 */
export function buildWaveform(samples: number[], bars: number = WAVEFORM_BARS): number[] {
  if (bars <= 0) return [];
  if (samples.length === 0) return new Array(bars).fill(0);

  const peaks: number[] = [];
  const bucketSize = samples.length / bars;
  for (let bar = 0; bar < bars; bar += 1) {
    const start = Math.floor(bar * bucketSize);
    const end = Math.max(start + 1, Math.floor((bar + 1) * bucketSize));
    let peak = 0;
    for (let index = start; index < end && index < samples.length; index += 1) {
      const value = Math.abs(samples[index]);
      if (value > peak) peak = value;
    }
    peaks.push(Math.min(1, peak));
  }
  return peaks;
}

/** Quantises peaks for storage, keeping the array small. */
export function encodeWaveform(peaks: number[]): number[] {
  return peaks.map((peak) => Math.max(0, Math.min(PEAK_MAX, Math.round(peak * PEAK_MAX))));
}

export function decodeWaveform(encoded: number[] | undefined, bars: number = WAVEFORM_BARS): number[] {
  if (!encoded || encoded.length === 0) return neutralWaveform(bars);
  return encoded.map((value) => Math.max(0, Math.min(1, value / PEAK_MAX)));
}

/**
 * Deterministic placeholder used when no peaks were stored.
 * A flat line would look broken, so it varies gently instead.
 */
export function neutralWaveform(bars: number = WAVEFORM_BARS): number[] {
  return Array.from({ length: bars }, (_, index) => {
    const wave = Math.sin((index / Math.max(1, bars - 1)) * Math.PI);
    return 0.25 + wave * 0.35;
  });
}

/** `mm:ss` for the player, and `m:ss` for anything under an hour. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * Decodes just enough of the recording to build a waveform.
 *
 * Any failure returns an empty array: a missing waveform must never stop a
 * voice message from being sent.
 */
export async function analyseWaveform(blob: Blob): Promise<number[]> {
  if (typeof OfflineAudioContext === "undefined" && typeof AudioContext === "undefined") return [];
  try {
    const bytes = await blob.arrayBuffer();
    const ContextCtor = typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : AudioContext;
    // A tiny context only decodes; it renders nothing, so the buffers stay small.
    const context = new ContextCtor(1, 1, 8000);
    const decoded = await context.decodeAudioData(bytes);
    const channel = decoded.getChannelData(0);
    // Sample at most ~16000 points: enough to find peaks, cheap to scan.
    const step = Math.max(1, Math.floor(channel.length / 16000));
    const samples: number[] = [];
    for (let index = 0; index < channel.length; index += step) samples.push(channel[index]);
    return encodeWaveform(buildWaveform(samples));
  } catch {
    return [];
  }
}
