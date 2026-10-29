/**
 * Video notes: a short round video recorded in the composer.
 *
 * The round shape is not decoration: it tells the reader the clip is a few seconds
 * long before they tap it, which is the difference between watching and skipping.
 */

/** A note longer than this is a video message, not a note. */
export const VIDEO_NOTE_MAX_MS = 60_000;

/** Older than this and a note arrives as a surprise. */
export const VIDEO_NOTE_WARN_MS = 45_000;

/** The video size a note is recorded at, square so the circle crops nothing. */
export const NOTE_SIZE = 480;

export const NOTE_BITRATE = 900_000;

/** Progress through the maximum, for the ring around the recording button. */
export function noteProgress(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.min(1, elapsedMs / VIDEO_NOTE_MAX_MS);
}

/** "0:07" for the recording timer. */
export function formatNoteTime(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const total = Math.floor(safe / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Whether the note is long enough to be worth sending. */
export function isSendableNote(ms: number): boolean {
  return ms >= 800;
}

/**
 * The media recorder options for a note.
 *
 * Chosen by what the browser actually supports rather than by preference: Safari
 * has no webm encoder, and asking for one there produces a recorder that fails on
 * the first frame.
 */
export function noteRecorderOptions(supportsWebm: boolean): MediaRecorderOptions {
  if (supportsWebm) {
    return { mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: NOTE_BITRATE };
  }
  return { mimeType: "video/mp4", videoBitsPerSecond: NOTE_BITRATE };
}

/** What the note's bubble says about its length. */
export function noteDurationLabel(ms: number): string {
  return formatNoteTime(ms);
}

/** The file name a note is stored under, so a download is recognisable. */
export function noteFileName(ms: number, extension: string): string {
  return `video-note-${Math.round(ms / 1000)}s.${extension}`;
}
